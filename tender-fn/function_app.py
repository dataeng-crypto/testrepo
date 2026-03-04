import azure.functions as func
import json
import logging
import os
import time
import base64
import hmac
import hashlib
from typing import Dict, Any

import bcrypt
import pyodbc
import requests

from azure.identity import DefaultAzureCredential
import jwt

from datetime import datetime, timedelta, timezone
from azure.storage.blob import generate_blob_sas, BlobSasPermissions

# Document Intelligence
from azure.core.credentials import AzureKeyCredential
from azure.ai.formrecognizer import DocumentAnalysisClient

app = func.FunctionApp()

SQL_TOKEN_ATTR = 1256  # ODBC constant for access token


# -----------------------------
# Helpers: CORS + JSON responses
# -----------------------------
def _cors_headers() -> Dict[str, str]:
    origin = os.environ.get("CORS_ORIGIN", "*")
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Credentials": "true",
    }


def _json(status: int, payload: Dict[str, Any]) -> func.HttpResponse:
    headers = {"Content-Type": "application/json", **_cors_headers()}
    return func.HttpResponse(json.dumps(payload, ensure_ascii=False), status_code=status, headers=headers)


def _options() -> func.HttpResponse:
    return func.HttpResponse("", status_code=204, headers=_cors_headers())


# -----------------------------
# SQL connection (SQL Auth preferred, AAD fallback)
# -----------------------------
def _get_sql_conn():
    server = os.environ.get("SQL_SERVER")
    database = os.environ.get("SQL_DATABASE")
    if not server or not database:
        raise RuntimeError("Missing SQL_SERVER / SQL_DATABASE in environment variables")

    user = os.environ.get("SQL_USER")
    password = os.environ.get("SQL_PASSWORD")

    # Preferred: SQL username/password
    if user and password:
        conn_str = (
            "Driver={ODBC Driver 18 for SQL Server};"
            f"Server=tcp:{server},1433;"
            f"Database={database};"
            f"Uid={user};"
            f"Pwd={password};"
            "Encrypt=yes;"
            "TrustServerCertificate=no;"
            "Connection Timeout=30;"
        )
        return pyodbc.connect(conn_str)

    # Fallback: AAD token (works if az login / managed identity configured)
    cred = DefaultAzureCredential()
    token = cred.get_token("https://database.windows.net/.default").token
    token_bytes = token.encode("utf-16-le")

    conn_str = (
        "Driver={ODBC Driver 18 for SQL Server};"
        f"Server=tcp:{server},1433;"
        f"Database={database};"
        "Encrypt=yes;"
        "TrustServerCertificate=no;"
        "Connection Timeout=30;"
    )
    return pyodbc.connect(conn_str, attrs_before={SQL_TOKEN_ATTR: token_bytes})


def _parse_azurewebjobsstorage():
    cs = os.environ.get("AzureWebJobsStorage", "")
    if not cs:
        raise RuntimeError("AzureWebJobsStorage is missing in env")

    parts = {}
    for kv in cs.split(";"):
        if "=" in kv:
            k, v = kv.split("=", 1)
            parts[k.strip()] = v.strip()

    account_name = parts.get("AccountName")
    account_key = parts.get("AccountKey")
    if not account_name or not account_key:
        raise RuntimeError("AzureWebJobsStorage must contain AccountName and AccountKey")

    return account_name, account_key


# -----------------------------
# Password hashing (bcrypt + PBKDF2 fallback)
# -----------------------------
def verify_password(password: str, stored: str) -> bool:
    if not stored:
        return False

    # bcrypt: $2b$...
    if stored.startswith("$2a$") or stored.startswith("$2b$") or stored.startswith("$2y$"):
        try:
            return bcrypt.checkpw(password.encode("utf-8"), stored.encode("utf-8"))
        except Exception:
            return False

    # pbkdf2: pbkdf2_sha256$iters$salt_b64$hash_b64
    try:
        algo, iters, salt_b64, hash_b64 = stored.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False

        iterations = int(iters)
        salt = base64.b64decode(salt_b64.encode("utf-8"))
        expected = base64.b64decode(hash_b64.encode("utf-8"))

        dk = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            iterations,
            dklen=len(expected),
        )
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False


# -----------------------------
# JWT helpers
# -----------------------------
def _jwt_secret() -> str:
    s = os.environ.get("JWT_SECRET", "")
    if not s or len(s) < 24:
        raise RuntimeError("JWT_SECRET is missing/too short. Set a strong secret (>= 24 chars).")
    return s


def issue_token(email: str, role: str, ttl_seconds: int = 8 * 3600) -> str:
    now = int(time.time())
    payload = {"sub": email, "role": role, "iat": now, "exp": now + ttl_seconds}
    return jwt.encode(payload, _jwt_secret(), algorithm="HS256")


def require_auth(req: func.HttpRequest) -> Dict[str, Any]:
    auth = req.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise PermissionError("Missing Bearer token")

    token = auth.split(" ", 1)[1].strip()
    try:
        return jwt.decode(token, _jwt_secret(), algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise PermissionError("Token expired")
    except Exception:
        raise PermissionError("Invalid token")


# -----------------------------
# Document Intelligence (text extraction)
# -----------------------------
def _di_client() -> DocumentAnalysisClient:
    endpoint = os.environ.get("DI_ENDPOINT", "").strip()
    key = os.environ.get("DI_KEY", "").strip()
    if not endpoint or not key:
        raise RuntimeError("Missing DI_ENDPOINT / DI_KEY in env")
    return DocumentAnalysisClient(endpoint=endpoint, credential=AzureKeyCredential(key))


def _extract_text_di(file_bytes: bytes) -> str:
    model_id = os.environ.get("DI_MODEL_ID", "prebuilt-read").strip()
    client = _di_client()

    poller = client.begin_analyze_document(model_id=model_id, document=file_bytes)
    result = poller.result()

    lines = []
    if getattr(result, "pages", None):
        for page in result.pages:
            for line in getattr(page, "lines", []) or []:
                if line.content:
                    lines.append(line.content)

    return "\n".join(lines).strip()


# -----------------------------
# Azure OpenAI (summary creation)
# -----------------------------
def _aoai_chat(text: str) -> str:
    """
    Env vars required:
      AOAI_ENDPOINT = https://<resource>.openai.azure.com
      AOAI_KEY
      AOAI_DEPLOYMENT = model deployment name (e.g. gpt-4o-mini, gpt-4.1-mini, etc.)
      AOAI_API_VERSION = 2024-02-15-preview (or your version)
    """
    endpoint = os.environ.get("AOAI_ENDPOINT", "").strip()
    key = os.environ.get("AOAI_KEY", "").strip()
    deployment = os.environ.get("AOAI_DEPLOYMENT", "").strip()
    api_version = os.environ.get("AOAI_API_VERSION", "2024-02-15-preview").strip()

    if not endpoint or not key or not deployment:
        raise RuntimeError("Missing AOAI_ENDPOINT / AOAI_KEY / AOAI_DEPLOYMENT in env")

    url = f"{endpoint}/openai/deployments/{deployment}/chat/completions?api-version={api_version}"

    system_msg = (
        "You are a senior EPC tender analyst. Return ONLY valid JSON.\n"
        "Schema:\n"
        "{"
        '"overview": "...",'
        '"scope": ["..."],'
        '"eligibility": ["..."],'
        '"technical_requirements": ["..."],'
        '"commercial_terms": ["..."],'
        '"submission_deadlines": ["..."],'
        '"evaluation_criteria": ["..."],'
        '"risks": ["..."],'
        '"clarifications_questions": ["..."]'
        "}\n"
        "Rules: No markdown, no backticks, no commentary. JSON only."
    )

    payload = {
        "temperature": 0.2,
        "max_tokens": 1400,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": f"TENDER_TEXT:\n{text}"},
        ],
    }

    r = requests.post(
        url,
        headers={"api-key": key, "Content-Type": "application/json"},
        json=payload,
        timeout=120,
    )
    r.raise_for_status()
    data = r.json()
    return (data.get("choices", [{}])[0].get("message", {}) or {}).get("content", "") or ""


# -----------------------------
# NEW: Excel-style structured JSON summary (Combined)
# -----------------------------
def _aoai_chat_excel_summary(text: str) -> str:
    """
    Produces EPC Tender Summary in structured JSON blocks (Excel-style).
    Single output JSON across the combined tender text.
    """
    endpoint = os.environ.get("AOAI_ENDPOINT", "").strip()
    key = os.environ.get("AOAI_KEY", "").strip()
    deployment = os.environ.get("AOAI_DEPLOYMENT", "").strip()
    api_version = os.environ.get("AOAI_API_VERSION", "2024-02-15-preview").strip()

    if not endpoint or not key or not deployment:
        raise RuntimeError("Missing AOAI_ENDPOINT / AOAI_KEY / AOAI_DEPLOYMENT in env")

    url = f"{endpoint}/openai/deployments/{deployment}/chat/completions?api-version={api_version}"

    system_msg = (
        "You are a senior EPC tender analyst.\n"
        "You will receive MULTIPLE tender documents concatenated.\n"
        "Return ONLY valid JSON. No markdown. No backticks. No commentary.\n"
        "If a value is not found, use null.\n"
        "Keep currency and date formats as found in the tender.\n"
        "If contradictions exist across documents, capture them in risk_analysis.conflicts and clarifications.\n\n"
        "JSON SCHEMA (exact keys):\n"
        "{\n"
        '  "basic_info": {\n'
        '    "tender_title": null,\n'
        '    "client": null,\n'
        '    "project_location": null,\n'
        '    "capacity_mw": null,\n'
        '    "tender_fee": null,\n'
        '    "emd": null,\n'
        '    "bid_submission_deadline": null,\n'
        '    "bid_opening_date": null,\n'
        '    "bid_validity": null,\n'
        '    "completion_period": null,\n'
        '    "contract_type": null\n'
        "  },\n"
        '  "scope_summary": {\n'
        '    "overview": null,\n'
        '    "major_supply": [],\n'
        '    "civil_scope": [],\n'
        '    "electrical_scope": [],\n'
        '    "testing_commissioning": [],\n'
        '    "exclusions": []\n'
        "  },\n"
        '  "eligibility": {\n'
        '    "financial": [],\n'
        '    "technical_experience": [],\n'
        '    "oem_requirements": [],\n'
        '    "certifications": [],\n'
        '    "other_conditions": []\n'
        "  },\n"
        '  "commercial_terms": {\n'
        '    "payment_terms": [],\n'
        '    "ld_clause": null,\n'
        '    "performance_guarantee": null,\n'
        '    "defect_liability": null,\n'
        '    "price_adjustment": null,\n'
        '    "warranty": null,\n'
        '    "taxes_duties": null,\n'
        '    "insurance": null\n'
        "  },\n"
        '  "evaluation": {\n'
        '    "technical_evaluation": [],\n'
        '    "commercial_evaluation": [],\n'
        '    "award_basis": null\n'
        "  },\n"
        '  "risk_analysis": {\n'
        '    "technical_risks": [],\n'
        '    "commercial_risks": [],\n'
        '    "timeline_risks": [],\n'
        '    "compliance_risks": [],\n'
        '    "conflicts": []\n'
        "  },\n"
        '  "clarifications": []\n'
        "}\n"
    )

    payload = {
        "temperature": 0.15,
        "max_tokens": 1500,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": f"COMBINED_TENDER_TEXT:\n{text}"},
        ],
    }

    r = requests.post(
        url,
        headers={"api-key": key, "Content-Type": "application/json"},
        json=payload,
        timeout=180,
    )
    r.raise_for_status()
    data = r.json()
    return (data.get("choices", [{}])[0].get("message", {}) or {}).get("content", "") or ""


def _safe_parse_json(s: str) -> Any:
    try:
        return json.loads(s)
    except Exception:
        return None


# -----------------------------
# AUTH: Login
# POST /api/auth/login
# -----------------------------
@app.route(route="auth/login", auth_level=func.AuthLevel.ANONYMOUS, methods=["POST", "OPTIONS"])
def auth_login(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return _options()

    try:
        body = req.get_json()
    except Exception:
        return _json(400, {"ok": False, "error": "Invalid JSON body"})

    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))

    if not email or not password:
        return _json(400, {"ok": False, "error": "Email and password required"})

    try:
        with _get_sql_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT Email, Role, PasswordHash, IsActive
                FROM dbo.AppUsers
                WHERE Email = ?
                """,
                email,
            )
            row = cur.fetchone()

        if not row:
            return _json(401, {"ok": False, "error": "Invalid credentials"})

        is_active = row.IsActive
        if isinstance(is_active, str):
            is_active_norm = is_active.strip().lower() in ("1", "true", "yes", "y")
        else:
            is_active_norm = bool(is_active)

        if not is_active_norm:
            return _json(403, {"ok": False, "error": "User is disabled"})

        if not verify_password(password, row.PasswordHash):
            return _json(401, {"ok": False, "error": "Invalid credentials"})

        token = issue_token(row.Email, row.Role)
        return _json(200, {"ok": True, "token": token, "email": row.Email, "role": row.Role})

    except Exception as e:
        logging.exception("auth_login failed")
        return _json(500, {"ok": False, "error": str(e)})


# -----------------------------
# DB Ping (Protected)
# GET /api/db/ping
# -----------------------------
@app.route(route="db/ping", auth_level=func.AuthLevel.ANONYMOUS, methods=["GET", "OPTIONS"])
def db_ping(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return _options()

    try:
        require_auth(req)
    except PermissionError as e:
        return _json(401, {"ok": False, "error": str(e)})

    try:
        with _get_sql_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT TOP 1 1 AS ok")
            row = cur.fetchone()

        return _json(
            200,
            {
                "ok": True,
                "db": os.environ.get("SQL_DATABASE"),
                "server": os.environ.get("SQL_SERVER"),
                "result": {"ok": int(row[0]) if row else None},
            },
        )
    except Exception as e:
        logging.exception("db_ping failed")
        return _json(500, {"ok": False, "error": str(e)})


# -----------------------------
# SAS (Protected)
# POST /api/storage/sas
# -----------------------------
@app.route(route="storage/sas", auth_level=func.AuthLevel.ANONYMOUS, methods=["POST", "OPTIONS"])
def storage_sas(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return _options()

    try:
        require_auth(req)
    except PermissionError as e:
        return _json(401, {"ok": False, "error": str(e)})

    try:
        body = req.get_json()
    except Exception:
        return _json(400, {"ok": False, "error": "Invalid JSON body"})

    filename = str(body.get("filename") or "").strip()
    content_type = str(body.get("contentType") or "application/octet-stream").strip()
    if not filename:
        return _json(400, {"ok": False, "error": "filename required"})

    safe = filename.replace("\\", "/").split("/")[-1]
    safe = "".join(ch for ch in safe if ch.isalnum() or ch in ("-", "_", ".", " ")).strip().replace(" ", "_")
    if not safe:
        safe = "tender.bin"

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    blob_name = f"{ts}_{safe}"
    container = "tenders"

    try:
        account_name, account_key = _parse_azurewebjobsstorage()
        expiry = datetime.now(timezone.utc) + timedelta(minutes=15)

        sas_upload = generate_blob_sas(
            account_name=account_name,
            container_name=container,
            blob_name=blob_name,
            account_key=account_key,
            permission=BlobSasPermissions(read=True, create=True, write=True),
            expiry=expiry,
        )

        sas_read = generate_blob_sas(
            account_name=account_name,
            container_name=container,
            blob_name=blob_name,
            account_key=account_key,
            permission=BlobSasPermissions(read=True),
            expiry=expiry,
        )

        base_url = f"https://{account_name}.blob.core.windows.net/{container}/{blob_name}"

        return _json(
            200,
            {
                "ok": True,
                "blobName": blob_name,
                "container": container,
                "contentType": content_type,
                "uploadUrl": f"{base_url}?{sas_upload}",
                "fileUrl": f"{base_url}?{sas_read}",
                "expiresAtUtc": expiry.isoformat(),
            },
        )

    except Exception as e:
        logging.exception("storage_sas failed")
        return _json(500, {"ok": False, "error": str(e)})


# -----------------------------
# analyzeTender
# POST /api/analyzeTender
# -----------------------------
@app.route(route="analyzeTender", auth_level=func.AuthLevel.ANONYMOUS, methods=["POST", "OPTIONS"])
def analyzeTender(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return _options()

    logging.info("analyzeTender called")

    try:
        body = req.get_json()
    except Exception:
        return _json(400, {"ok": False, "error": "Invalid JSON body"})

    text = (body.get("text") or "").strip()
    file_url = (body.get("fileUrl") or "").strip()

    if not text and not file_url:
        return _json(400, {"ok": False, "error": "Provide 'text' or 'fileUrl'"})

    try:
        # 1) Get tender text
        extracted_text = text
        mode = "text" if text else "fileUrl"

        if file_url:
            # download blob (SAS read URL)
            r = requests.get(file_url, timeout=120)
            r.raise_for_status()
            file_bytes = r.content

            # extract using Document Intelligence (best for scanned PDFs)
            extracted_text = _extract_text_di(file_bytes)

            if not extracted_text:
                return _json(400, {"ok": False, "error": "Document Intelligence extracted no text"})

        # Limit to protect token usage
        extracted_text = extracted_text[:160000]

        # 2) Summarize using Azure OpenAI
        summary_raw = _aoai_chat(extracted_text)
        summary_json = _safe_parse_json(summary_raw)

        return _json(
            200,
            {
                "ok": True,
                "mode": mode,
                "received_chars": len(extracted_text),
                "summary_raw": summary_raw,
                "summary_json": summary_json,  # null if model didn't return valid JSON
            },
        )

    except Exception as e:
        logging.exception("analyzeTender failed")
        return _json(500, {"ok": False, "error": str(e)})


# -----------------------------
# NEW: analyzeTenderBatch (Combined summary for multiple files)
# POST /api/analyzeTenderBatch
# -----------------------------
@app.route(route="analyzeTenderBatch", auth_level=func.AuthLevel.ANONYMOUS, methods=["POST", "OPTIONS"])
def analyzeTenderBatch(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return _options()

    logging.info("analyzeTenderBatch called")

    # Protected endpoint (same style as /storage/sas)
    try:
        require_auth(req)
    except PermissionError as e:
        return _json(401, {"ok": False, "error": str(e)})

    try:
        body = req.get_json()
    except Exception:
        return _json(400, {"ok": False, "error": "Invalid JSON body"})

    file_urls = body.get("fileUrls") or []
    if not isinstance(file_urls, list) or not file_urls:
        return _json(400, {"ok": False, "error": "Provide 'fileUrls' as a non-empty array"})

    # safety caps
    max_files = int(os.environ.get("BATCH_MAX_FILES", "15"))
    per_file_cap = int(os.environ.get("BATCH_PER_FILE_CHAR_CAP", "60000"))
    total_cap = int(os.environ.get("BATCH_TOTAL_CHAR_CAP", "160000"))

    file_urls = [str(x).strip() for x in file_urls if str(x).strip()]
    if len(file_urls) > max_files:
        return _json(400, {"ok": False, "error": f"Too many files. Max {max_files}."})

    try:
        extracted_parts = []
        meta_files = []
        total_chars_raw = 0

        for idx, url in enumerate(file_urls, start=1):
            # download blob (SAS read URL)
            r = requests.get(url, timeout=180)
            r.raise_for_status()
            file_bytes = r.content

            # extract using Document Intelligence
            txt = _extract_text_di(file_bytes) or ""
            txt = txt.strip()

            if not txt:
                meta_files.append({"fileUrl": url, "received_chars": 0})
                continue

            # cap per file
            txt = txt[:per_file_cap]

            meta_files.append({"fileUrl": url, "received_chars": len(txt)})

            extracted_parts.append(
                f"\n\n===== TENDER_FILE_{idx} START =====\n{txt}\n===== TENDER_FILE_{idx} END =====\n"
            )
            total_chars_raw += len(txt)

        if not extracted_parts:
            return _json(400, {"ok": False, "error": "All files extracted no text"})

        combined_text = "".join(extracted_parts)[:total_cap]
        combined_text = combined_text[:120000]

        # Summarize once (Excel-style structured JSON)
        summary_raw = _aoai_chat_excel_summary(combined_text)
        summary_json = _safe_parse_json(summary_raw)

        return _json(
            200,
            {
                "ok": True,
                "mode": "batch",
                "files": meta_files,
                "total_chars": len(combined_text),
                "summary_raw": summary_raw,
                "summary_json": summary_json,
            },
        )

    except Exception as e:
        logging.exception("analyzeTenderBatch failed")
        return _json(500, {"ok": False, "error": str(e)})


# -----------------------------
# Blob Trigger (keep as-is)
# -----------------------------
@app.blob_trigger(arg_name="myblob", path="tenders/{name}", connection="AzureWebJobsStorage")
def BlobTenderIngest(myblob: func.InputStream):
    logging.info(
        f"Python blob trigger processed blob Name: {myblob.name} Size: {myblob.length} bytes"
    )