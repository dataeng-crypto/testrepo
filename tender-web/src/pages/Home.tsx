import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { logout, getUser } from "../services/auth";
import { api } from "../services/api";

type SasResponse = {
  ok: boolean;
  uploadUrl?: string;
  fileUrl?: string;
  blobName?: string;
  container?: string;
  expiresAtUtc?: string;
  error?: string;
};

type ExcelTenderSummary = {
  basic_info?: {
    tender_title?: string | null;
    client?: string | null;
    bid_no?: string | null;
    tender_id?: string | null;
    rfp_no?: string | null;
    project_location?: string | null;
    capacity_mw?: string | null;
    tender_fee?: string | null;
    emd?: string | null;
    bid_submission_deadline?: string | null;
    bid_opening_date?: string | null;
    bid_validity?: string | null;
    completion_period?: string | null;
    contract_type?: string | null;
  };
  scope_summary?: {
    overview?: string | null;
    major_supply?: string[];
    civil_scope?: string[];
    electrical_scope?: string[];
    testing_commissioning?: string[];
    exclusions?: string[];
  };
  eligibility?: {
    financial?: string[];
    technical_experience?: string[];
    oem_requirements?: string[];
    certifications?: string[];
    other_conditions?: string[];
  };
  commercial_terms?: {
    payment_terms?: string[];
    ld_clause?: string | null;
    performance_guarantee?: string | null;
    defect_liability?: string | null;
    price_adjustment?: string | null;
    warranty?: string | null;
    taxes_duties?: string | null;
    insurance?: string | null;
  };
  evaluation?: {
    technical_evaluation?: string[];
    commercial_evaluation?: string[];
    award_basis?: string | null;
  };
  risk_analysis?: {
    technical_risks?: string[];
    commercial_risks?: string[];
    timeline_risks?: string[];
    compliance_risks?: string[];
    conflicts?: string[];
  };
  clarifications?: string[];
};

type AnalyzeTenderBatchResponse = {
  ok: boolean;
  mode?: "batch";
  files?: { fileUrl: string; received_chars: number }[];
  total_chars?: number;
  summary_raw?: string;
  summary_json?: ExcelTenderSummary | null;
  error?: string;
};

type FileResult = {
  id: string;
  fileName: string;
  sizeKb: number;
  status: "queued" | "uploading" | "uploaded" | "analyzing" | "done" | "error";
  fileUrl?: string;
  error?: string;
};

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "radial-gradient(1200px 600px at 20% 0%, rgba(56,189,248,0.10), transparent 55%), radial-gradient(900px 600px at 90% 10%, rgba(167,139,250,0.10), transparent 60%), linear-gradient(180deg, #0b1220 0%, #0f172a 45%, #111827 100%)",
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial",
    color: "#e5e7eb",
  },
  topbar: {
    position: "sticky" as const,
    top: 0,
    zIndex: 20,
    backdropFilter: "blur(10px)",
    background: "rgba(3,7,18,0.58)",
    borderBottom: "1px solid rgba(148,163,184,0.12)",
  },
  topbarInner: {
    maxWidth: 1240,
    margin: "0 auto",
    padding: "14px 18px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: { margin: 0, fontSize: 18.5, fontWeight: 850, letterSpacing: 0.2 },
  meta: { margin: 0, marginTop: 4, fontSize: 13, color: "#9ca3af" },

  container: { maxWidth: 1240, margin: "0 auto", padding: "18px 18px 34px" },
  grid: { display: "grid", gridTemplateColumns: "440px 1fr", gap: 16 },

  card: {
    background: "rgba(17, 24, 39, 0.72)",
    border: "1px solid rgba(148,163,184,0.14)",
    borderRadius: 16,
    padding: 16,
    boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
    backdropFilter: "blur(10px)",
  },
  cardTitle: { margin: 0, fontSize: 14.5, fontWeight: 850, color: "#f9fafb" },
  cardSub: { marginTop: 6, marginBottom: 0, fontSize: 13, color: "#9ca3af", lineHeight: 1.4 },

  label: { marginTop: 12, fontSize: 12.5, color: "#cbd5e1", fontWeight: 700 },

  // Dropzone / file input
  drop: {
    marginTop: 10,
    borderRadius: 14,
    border: "1px dashed rgba(148,163,184,0.28)",
    background: "rgba(2,6,23,0.28)",
    padding: 14,
  },
  file: {
    marginTop: 10,
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,0.18)",
    background: "rgba(2,6,23,0.45)",
    color: "#e5e7eb",
  },

  btnRow: { display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" as const },
  btn: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,0.18)",
    background: "linear-gradient(180deg, #1f2937 0%, #111827 100%)",
    color: "#f9fafb",
    fontWeight: 800,
    cursor: "pointer",
  },
  btnSecondary: { background: "transparent", color: "#e5e7eb" },
  btnDanger: {
    background: "linear-gradient(180deg, rgba(239,68,68,0.25) 0%, rgba(239,68,68,0.12) 100%)",
    border: "1px solid rgba(239,68,68,0.35)",
  },
  btnDisabled: { opacity: 0.6, cursor: "not-allowed" as const },

  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(148,163,184,0.16)",
    background: "rgba(2,6,23,0.35)",
    color: "#cbd5e1",
    fontSize: 12.5,
    whiteSpace: "nowrap" as const,
  },

  list: { display: "grid", gap: 12 },

  item: {
    border: "1px solid rgba(148,163,184,0.12)",
    borderRadius: 14,
    padding: 14,
    background: "rgba(2,6,23,0.25)",
  },
  itemTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  fileName: { margin: 0, fontSize: 14.5, fontWeight: 850, color: "#f9fafb" },
  fileMeta: { margin: 0, marginTop: 6, fontSize: 12.5, color: "#9ca3af" },

  // Progress bar
  barWrap: {
    marginTop: 10,
    height: 8,
    borderRadius: 999,
    overflow: "hidden",
    background: "rgba(148,163,184,0.12)",
    border: "1px solid rgba(148,163,184,0.10)",
  },
  bar: { height: "100%", width: "0%", background: "linear-gradient(90deg, rgba(56,189,248,0.85), rgba(167,139,250,0.85))" },

  section: {
    borderTop: "1px solid rgba(148,163,184,0.12)",
    paddingTop: 10,
    marginTop: 10,
  },
  sectionTitle: { margin: 0, fontSize: 13, fontWeight: 850, color: "#f9fafb" },
  text: { marginTop: 8, marginBottom: 0, fontSize: 13.5, color: "#e5e7eb", lineHeight: 1.55 },

  ul: { marginTop: 8, marginBottom: 0, paddingLeft: 18, color: "#e5e7eb" },
  li: { margin: "6px 0", fontSize: 13.5, lineHeight: 1.45 },

  kvGrid: { display: "grid", gridTemplateColumns: "220px 1fr", gap: 10, marginTop: 10 },
  k: { color: "#cbd5e1", fontSize: 12.5, fontWeight: 750 },
  v: { color: "#e5e7eb", fontSize: 13.5 },

  // Toolbar on summary
  summaryToolbar: {
    marginTop: 12,
    display: "flex",
    gap: 10,
    flexWrap: "wrap" as const,
    alignItems: "center",
    justifyContent: "space-between",
  },
  search: {
    flex: "1 1 280px",
    minWidth: 240,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,0.18)",
    background: "rgba(2,6,23,0.45)",
    color: "#e5e7eb",
    outline: "none",
  },

  // Accordion
  acc: {
    marginTop: 12,
    borderRadius: 14,
    overflow: "hidden",
    border: "1px solid rgba(148,163,184,0.12)",
    background: "rgba(2,6,23,0.20)",
  },
  accHead: {
    width: "100%",
    textAlign: "left" as const,
    padding: "12px 12px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    border: "none",
    cursor: "pointer",
    background: "rgba(2,6,23,0.22)",
    color: "#f9fafb",
    fontWeight: 850,
  },
  accBody: { padding: 12 },

  // Decision card
  decisionRow: { display: "grid", gridTemplateColumns: "1fr 220px", gap: 12, alignItems: "center" },
  scoreBox: {
    borderRadius: 14,
    border: "1px solid rgba(148,163,184,0.14)",
    background: "rgba(2,6,23,0.24)",
    padding: 12,
  },
  score: { fontSize: 28, fontWeight: 900, margin: 0, color: "#f9fafb" },
  scoreMeta: { margin: "6px 0 0 0", fontSize: 12.5, color: "#9ca3af" },

  err: {
    marginTop: 10,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(239,68,68,0.35)",
    background: "rgba(239,68,68,0.10)",
    color: "#fecaca",
    fontSize: 13.5,
    lineHeight: 1.35,
  },
  warn: {
    marginTop: 10,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(245,158,11,0.35)",
    background: "rgba(245,158,11,0.10)",
    color: "#fde68a",
    fontSize: 13.5,
    lineHeight: 1.35,
  },
};

function renderList(items?: string[], query?: string) {
  const arr = (items || []).filter(Boolean);
  const q = (query || "").trim().toLowerCase();
  const filtered = !q ? arr : arr.filter((x) => String(x).toLowerCase().includes(q));
  if (!filtered || filtered.length === 0) return <p style={styles.text}>—</p>;
  return (
    <ul style={styles.ul}>
      {filtered.map((x, i) => (
        <li key={i} style={styles.li}>
          {x}
        </li>
      ))}
    </ul>
  );
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function statusLabel(s: FileResult["status"]) {
  switch (s) {
    case "queued":
      return "Queued";
    case "uploading":
      return "Uploading";
    case "uploaded":
      return "Uploaded";
    case "analyzing":
      return "Analyzing";
    case "done":
      return "Done";
    case "error":
      return "Error";
    default:
      return s;
  }
}

function statusProgress(s: FileResult["status"]) {
  switch (s) {
    case "queued":
      return 5;
    case "uploading":
      return 35;
    case "uploaded":
      return 55;
    case "analyzing":
      return 80;
    case "done":
      return 100;
    case "error":
      return 100;
    default:
      return 0;
  }
}

function safeStr(x?: string | null) {
  const v = (x ?? "").toString().trim();
  return v.length ? v : "—";
}

function flattenForSearch(summary: ExcelTenderSummary | null): string {
  if (!summary) return "";
  const parts: string[] = [];
  const pushArr = (a?: string[]) => (a || []).forEach((x) => x && parts.push(String(x)));
  const bi = summary.basic_info;
  if (bi) Object.values(bi).forEach((v) => v && parts.push(String(v)));
  const sc = summary.scope_summary;
  if (sc) {
    if (sc.overview) parts.push(sc.overview);
    pushArr(sc.major_supply);
    pushArr(sc.civil_scope);
    pushArr(sc.electrical_scope);
    pushArr(sc.testing_commissioning);
    pushArr(sc.exclusions);
  }
  const el = summary.eligibility;
  if (el) {
    pushArr(el.financial);
    pushArr(el.technical_experience);
    pushArr(el.oem_requirements);
    pushArr(el.certifications);
    pushArr(el.other_conditions);
  }
  const ct = summary.commercial_terms;
  if (ct) {
    pushArr(ct.payment_terms);
    if (ct.ld_clause) parts.push(ct.ld_clause);
    if (ct.performance_guarantee) parts.push(ct.performance_guarantee);
    if (ct.defect_liability) parts.push(ct.defect_liability);
    if (ct.price_adjustment) parts.push(ct.price_adjustment);
    if (ct.warranty) parts.push(ct.warranty);
    if (ct.taxes_duties) parts.push(ct.taxes_duties);
    if (ct.insurance) parts.push(ct.insurance);
  }
  const ev = summary.evaluation;
  if (ev) {
    pushArr(ev.technical_evaluation);
    pushArr(ev.commercial_evaluation);
    if (ev.award_basis) parts.push(ev.award_basis);
  }
  const rk = summary.risk_analysis;
  if (rk) {
    pushArr(rk.technical_risks);
    pushArr(rk.commercial_risks);
    pushArr(rk.timeline_risks);
    pushArr(rk.compliance_risks);
    pushArr(rk.conflicts);
  }
  pushArr(summary.clarifications);
  return parts.join("\n").toLowerCase();
}

function computeBidDecision(summary: ExcelTenderSummary | null) {
  if (!summary) {
    return { score: 0, decision: "—", rationale: ["No summary available."], actions: [] as string[] };
  }

  const r = summary.risk_analysis || {};
  const el = summary.eligibility || {};
  const ct = summary.commercial_terms || {};
  const sc = summary.scope_summary || {};
  const bi = summary.basic_info || {};

  const count = (a?: string[]) => (a || []).filter(Boolean).length;

  const techRisks = count(r.technical_risks);
  const commRisks = count(r.commercial_risks);
  const timeRisks = count(r.timeline_risks);
  const compRisks = count(r.compliance_risks);
  const conflicts = count(r.conflicts);

  const finElig = count(el.financial);
  const techElig = count(el.technical_experience);
  const oemReq = count(el.oem_requirements);
  const certs = count(el.certifications);
  const otherElig = count(el.other_conditions);

  // Heuristic scoring (client-side only; backend remains intact)
  let score = 70;

  // Risks hit harder than eligibilities
  score -= techRisks * 3;
  score -= commRisks * 3;
  score -= timeRisks * 2;
  score -= compRisks * 4;
  score -= conflicts * 4;

  // Eligibility complexity = effort/time risk
  const eligComplexity = finElig + techElig + oemReq + certs + otherElig;
  score -= Math.min(18, eligComplexity); // cap

  // Commercial red flags (simple keyword checks)
  const redFlagText = [
    ct.ld_clause || "",
    ct.payment_terms?.join(" ") || "",
    ct.performance_guarantee || "",
    ct.defect_liability || "",
  ]
    .join(" ")
    .toLowerCase();

  const redFlags = [
    { key: "unlimited", penalty: 8, label: "Unlimited liability / unlimited LD" },
    { key: "unlimited ld", penalty: 8, label: "Unlimited LD" },
    { key: "no advance", penalty: 4, label: "No advance / adverse cashflow" },
    { key: "back to back", penalty: 4, label: "Back-to-back risk" },
    { key: "at site", penalty: 2, label: "At-site payment dependency" },
    { key: "retention", penalty: 2, label: "High retention impact" },
  ];

  const matchedRedFlags = redFlags.filter((x) => x.key && redFlagText.includes(x.key));
  matchedRedFlags.forEach((x) => (score -= x.penalty));

  // Scope clarity helps a little
  const scopeSignals =
    count(sc.major_supply) + count(sc.civil_scope) + count(sc.electrical_scope) + count(sc.testing_commissioning);
  if (scopeSignals >= 12) score += 5;
  if (scopeSignals === 0) score -= 6;

  // Missing key dates is a governance risk
  const missingDates = [
    !bi.bid_submission_deadline,
    !bi.bid_opening_date,
    !bi.bid_validity,
    !bi.completion_period,
  ].filter(Boolean).length;
  score -= missingDates * 3;

  score = Math.max(0, Math.min(100, Math.round(score)));

  let decision = "Bid (Green)";
  if (score < 50) decision = "No Bid (Red)";
  else if (score < 70) decision = "Bid with Mitigations (Amber)";

  const rationale: string[] = [];
  rationale.push(`Risk items: Tech ${techRisks}, Commercial ${commRisks}, Timeline ${timeRisks}, Compliance ${compRisks}, Conflicts ${conflicts}.`);
  rationale.push(`Eligibility complexity items: ${eligComplexity}.`);
  if (matchedRedFlags.length) rationale.push(`Commercial red flags detected: ${matchedRedFlags.map((x) => x.label).join("; ")}.`);
  if (missingDates) rationale.push(`Key dates missing: ${missingDates} field(s) not extracted.`);
  if (scopeSignals === 0) rationale.push("Scope lists look empty/unclear in extracted summary (validation required).");

  const actions: string[] = [];
  if (decision !== "Bid (Green)") {
    actions.push("Run eligibility checklist with proofs: audited financials, relevant EPC experience, OEM authorizations, certifications.");
    actions.push("Create deviation list for commercial clauses (LD cap, liability cap, payment security, retention, PBG).");
    actions.push("Validate all key dates from tender portal/PDF (submission, opening, validity, completion) and align internal timeline.");
  } else {
    actions.push("Proceed to bid planning: BOQ take-off, vendor RFQs, construction methodology, project schedule, and cost baseline.");
    actions.push("Still validate extracted clauses against the tender documents (spot-check).");
  }

  return { score, decision, rationale, actions };
}

/**
 * Export to Excel (single file) using Excel 2003 XML Spreadsheet format.
 * - Opens directly in Excel
 * - No third-party libs
 * - Keeps backend intact (export uses already produced summary_json)
 */
function exportSummaryToExcelXml(summary: ExcelTenderSummary, meta: { totalChars?: number; fileCount?: number } | null) {
  const esc = (s: any) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(
    now.getHours()
  ).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;

  const decision = computeBidDecision(summary);

  const rowsKV = (title: string, obj: Record<string, any>) => {
    const keys = Object.keys(obj);
    const rows = keys
      .map((k) => {
        const v = obj[k];
        return `<Row>
  <Cell><Data ss:Type="String">${esc(k)}</Data></Cell>
  <Cell><Data ss:Type="String">${esc(v ?? "—")}</Data></Cell>
</Row>`;
      })
      .join("\n");

    return `<Worksheet ss:Name="${esc(title)}">
<Table>
<Row>
  <Cell><Data ss:Type="String">Field</Data></Cell>
  <Cell><Data ss:Type="String">Value</Data></Cell>
</Row>
${rows}
</Table>
</Worksheet>`;
  };

  const rowsList = (title: string, sections: { header: string; items?: string[] }[]) => {
    const body: string[] = [];
    body.push(`<Row><Cell><Data ss:Type="String">Section</Data></Cell><Cell><Data ss:Type="String">Item</Data></Cell></Row>`);
    for (const sec of sections) {
      const arr = (sec.items || []).filter(Boolean);
      if (!arr.length) {
        body.push(
          `<Row><Cell><Data ss:Type="String">${esc(sec.header)}</Data></Cell><Cell><Data ss:Type="String">—</Data></Cell></Row>`
        );
      } else {
        for (const it of arr) {
          body.push(
            `<Row><Cell><Data ss:Type="String">${esc(sec.header)}</Data></Cell><Cell><Data ss:Type="String">${esc(it)}</Data></Cell></Row>`
          );
        }
      }
    }

    return `<Worksheet ss:Name="${esc(title)}">
<Table>
${body.join("\n")}
</Table>
</Worksheet>`;
  };

  const bi = summary.basic_info || {};
  const sc = summary.scope_summary || {};
  const el = summary.eligibility || {};
  const ct = summary.commercial_terms || {};
  const ev = summary.evaluation || {};
  const rk = summary.risk_analysis || {};

  const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
<Styles>
 <Style ss:ID="hdr">
  <Font ss:Bold="1"/>
 </Style>
</Styles>

<Worksheet ss:Name="Meta">
<Table>
<Row>
  <Cell ss:StyleID="hdr"><Data ss:Type="String">Key</Data></Cell>
  <Cell ss:StyleID="hdr"><Data ss:Type="String">Value</Data></Cell>
</Row>
<Row><Cell><Data ss:Type="String">Generated At</Data></Cell><Cell><Data ss:Type="String">${esc(now.toISOString())}</Data></Cell></Row>
<Row><Cell><Data ss:Type="String">Files Analyzed</Data></Cell><Cell><Data ss:Type="String">${esc(meta?.fileCount ?? "—")}</Data></Cell></Row>
<Row><Cell><Data ss:Type="String">Total Chars</Data></Cell><Cell><Data ss:Type="String">${esc(meta?.totalChars ?? "—")}</Data></Cell></Row>
</Table>
</Worksheet>

<Worksheet ss:Name="Bid Decision">
<Table>
<Row>
  <Cell ss:StyleID="hdr"><Data ss:Type="String">Field</Data></Cell>
  <Cell ss:StyleID="hdr"><Data ss:Type="String">Value</Data></Cell>
</Row>
<Row><Cell><Data ss:Type="String">Decision</Data></Cell><Cell><Data ss:Type="String">${esc(decision.decision)}</Data></Cell></Row>
<Row><Cell><Data ss:Type="String">Score</Data></Cell><Cell><Data ss:Type="Number">${esc(decision.score)}</Data></Cell></Row>
<Row><Cell><Data ss:Type="String">Rationale</Data></Cell><Cell><Data ss:Type="String">${esc(decision.rationale.join(" | "))}</Data></Cell></Row>
<Row><Cell><Data ss:Type="String">Actions</Data></Cell><Cell><Data ss:Type="String">${esc(decision.actions.join(" | "))}</Data></Cell></Row>
</Table>
</Worksheet>

${rowsKV("Basic Info", {
  "Tender Title": bi.tender_title ?? "—",
  Client: bi.client ?? "—",
  "Bid No": (bi as any).bid_no ?? "—",
  "Tender ID": (bi as any).tender_id ?? "—",
  "RFP No": (bi as any).rfp_no ?? "—",
  "Project Location": bi.project_location ?? "—",
  "Capacity (MW)": bi.capacity_mw ?? "—",
  "Tender Fee": bi.tender_fee ?? "—",
  EMD: bi.emd ?? "—",
  "Bid Submission Deadline": bi.bid_submission_deadline ?? "—",
  "Bid Opening Date": bi.bid_opening_date ?? "—",
  "Bid Validity": bi.bid_validity ?? "—",
  "Completion Period": bi.completion_period ?? "—",
  "Contract Type": bi.contract_type ?? "—",
})}

${rowsList("Scope", [
  { header: "Overview", items: sc.overview ? [sc.overview] : [] },
  { header: "Major Supply", items: sc.major_supply },
  { header: "Civil Scope", items: sc.civil_scope },
  { header: "Electrical Scope", items: sc.electrical_scope },
  { header: "Testing & Commissioning", items: sc.testing_commissioning },
  { header: "Exclusions", items: sc.exclusions },
])}

${rowsList("Eligibility", [
  { header: "Financial", items: el.financial },
  { header: "Technical Experience", items: el.technical_experience },
  { header: "OEM Requirements", items: el.oem_requirements },
  { header: "Certifications", items: el.certifications },
  { header: "Other Conditions", items: el.other_conditions },
])}

${rowsKV("Commercial - Key Clauses", {
  "LD Clause": ct.ld_clause ?? "—",
  "Performance Guarantee": ct.performance_guarantee ?? "—",
  "Defect Liability": ct.defect_liability ?? "—",
  "Price Adjustment": ct.price_adjustment ?? "—",
  Warranty: ct.warranty ?? "—",
  "Taxes & Duties": ct.taxes_duties ?? "—",
  Insurance: ct.insurance ?? "—",
})}

${rowsList("Commercial - Payment", [{ header: "Payment Terms", items: ct.payment_terms }])}

${rowsList("Evaluation", [
  { header: "Technical Evaluation", items: ev.technical_evaluation },
  { header: "Commercial Evaluation", items: ev.commercial_evaluation },
  { header: "Award Basis", items: ev.award_basis ? [ev.award_basis] : [] },
])}

${rowsList("Risks", [
  { header: "Technical Risks", items: rk.technical_risks },
  { header: "Commercial Risks", items: rk.commercial_risks },
  { header: "Timeline Risks", items: rk.timeline_risks },
  { header: "Compliance Risks", items: rk.compliance_risks },
  { header: "Conflicts Across Documents", items: rk.conflicts },
])}

${rowsList("Clarifications", [{ header: "Clarifications", items: summary.clarifications }])}

</Workbook>`;

  const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
  const fileNameSafe =
    (summary.basic_info?.tender_title || "Tender_Summary").toString().replace(/[^\w\-]+/g, "_").slice(0, 50) ||
    "Tender_Summary";
  const filename = `${fileNameSafe}_${stamp}.xls`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadJson(summary: ExcelTenderSummary, meta: { totalChars?: number; fileCount?: number } | null) {
  const payload = {
    generatedAt: new Date().toISOString(),
    meta,
    summary,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tender_summary_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function copyToClipboard(text: string) {
  return navigator.clipboard.writeText(text);
}

function Accordion({
  title,
  defaultOpen,
  children,
  rightSlot,
}: {
  title: string;
  defaultOpen?: boolean;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div style={styles.acc}>
      <button type="button" style={styles.accHead} onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          {rightSlot}
          <span style={{ opacity: 0.8 }}>{open ? "▾" : "▸"}</span>
        </span>
      </button>
      {open ? <div style={styles.accBody}>{children}</div> : null}
    </div>
  );
}

export default function DashboardPage() {
  const nav = useNavigate();
  const user = getUser();

  const [files, setFiles] = useState<File[]>([]);
  const [items, setItems] = useState<FileResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [globalError, setGlobalError] = useState("");

  const [combined, setCombined] = useState<ExcelTenderSummary | null>(null);
  const [combinedMeta, setCombinedMeta] = useState<{ totalChars?: number; fileCount?: number } | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState<string>("");

  const canSubmit = useMemo(() => files.length > 0 && files.some((f) => f.size > 0), [files]);

  const combinedSearchText = useMemo(() => flattenForSearch(combined), [combined]);
  const searchWarn = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return "";
    if (!combined) return "";
    return combinedSearchText.includes(q) ? "" : "No matches found in extracted summary. Either the term is absent or extraction missed it.";
  }, [searchQuery, combined, combinedSearchText]);

  const bidDecision = useMemo(() => computeBidDecision(combined), [combined]);

  async function onLogout() {
    await logout();
    nav("/login");
  }

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2200);
  }

  function onPickFiles(list: FileList | null) {
    const arr = list ? Array.from(list) : [];
    setFiles(arr);

    setItems(
      arr.map((f) => ({
        id: uid(),
        fileName: f.name,
        sizeKb: Math.round(f.size / 1024),
        status: "queued",
      }))
    );

    setCombined(null);
    setCombinedMeta(null);
    setGlobalError("");
    setSearchQuery("");
  }

  async function uploadOne(file: File, itemId: string): Promise<string> {
    setItems((prev) => prev.map((x) => (x.id === itemId ? { ...x, status: "uploading", error: "" } : x)));

    const sas = await api<SasResponse>("/storage/sas", {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
      }),
      headers: { "Content-Type": "application/json" },
    });

    if (!sas?.ok || !sas.uploadUrl || !sas.fileUrl) {
      throw new Error(sas?.error || "Failed to get upload URL");
    }

    const putRes = await fetch(sas.uploadUrl, {
      method: "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });

    if (!putRes.ok) {
      const t = await putRes.text().catch(() => "");
      throw new Error(`Blob upload failed: ${putRes.status} ${putRes.statusText}${t ? ` - ${t}` : ""}`);
    }

    setItems((prev) => prev.map((x) => (x.id === itemId ? { ...x, status: "uploaded", fileUrl: sas.fileUrl } : x)));

    return sas.fileUrl;
  }

  async function onCreateCombinedSummary() {
    if (!canSubmit || busy) return;

    setBusy(true);
    setGlobalError("");
    setCombined(null);
    setCombinedMeta(null);
    setSearchQuery("");

    try {
      const urls: string[] = [];

      // 1) upload each file (sequential)
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const it = items[i];
        if (!f || !it) continue;

        try {
          const url = await uploadOne(f, it.id);
          urls.push(url);
        } catch (e: any) {
          setItems((prev) =>
            prev.map((x) =>
              x.id === it.id ? { ...x, status: "error", error: e?.message || "Upload failed" } : x
            )
          );
        }
      }

      const okUrls = urls.filter(Boolean);
      if (okUrls.length === 0) throw new Error("No files uploaded successfully.");

      // 2) analyze once
      setItems((prev) => prev.map((x) => (x.status === "uploaded" ? { ...x, status: "analyzing" } : x)));

      const res = await api<AnalyzeTenderBatchResponse>("/analyzeTenderBatch", {
        method: "POST",
        body: JSON.stringify({ fileUrls: okUrls }),
        headers: { "Content-Type": "application/json" },
      });

      if (!res?.ok) throw new Error(res?.error || "Batch analysis failed");

      setCombined(res.summary_json || null);
      setCombinedMeta({ totalChars: res.total_chars, fileCount: okUrls.length });

      setItems((prev) => prev.map((x) => (x.status === "analyzing" ? { ...x, status: "done" } : x)));

      showToast("Summary generated.");
    } catch (e: any) {
      setGlobalError(e?.message || "Processing failed");
    } finally {
      setBusy(false);
    }
  }

  function KV({ k, v }: { k: string; v?: string | null }) {
    const q = searchQuery.trim().toLowerCase();
    const vv = v ?? "—";
    const highlight =
      q && String(k).toLowerCase().includes(q)
        ? true
        : q && String(vv).toLowerCase().includes(q);

    return (
      <>
        <div style={{ ...styles.k, opacity: highlight ? 1 : 0.9 }}>{k}</div>
        <div style={{ ...styles.v, outline: highlight ? "1px solid rgba(56,189,248,0.35)" : "none", borderRadius: 8, padding: highlight ? "2px 6px" : 0 }}>
          {vv ?? "—"}
        </div>
      </>
    );
  }

  const isEmptySummary = useMemo(() => {
    if (!combined) return true;
    const bi = combined.basic_info || {};
    const sc = combined.scope_summary || {};
    const el = combined.eligibility || {};
    const ct = combined.commercial_terms || {};
    const ev = combined.evaluation || {};
    const rk = combined.risk_analysis || {};
    const anyStr =
      Object.values(bi).some((x) => (x ?? "").toString().trim().length) ||
      (sc.overview ?? "").toString().trim().length ||
      (ct.ld_clause ?? "").toString().trim().length ||
      (ev.award_basis ?? "").toString().trim().length;
    const anyArr =
      (sc.major_supply || []).length ||
      (sc.civil_scope || []).length ||
      (sc.electrical_scope || []).length ||
      (sc.testing_commissioning || []).length ||
      (sc.exclusions || []).length ||
      (el.financial || []).length ||
      (el.technical_experience || []).length ||
      (el.oem_requirements || []).length ||
      (el.certifications || []).length ||
      (el.other_conditions || []).length ||
      (ct.payment_terms || []).length ||
      (ev.technical_evaluation || []).length ||
      (ev.commercial_evaluation || []).length ||
      (rk.technical_risks || []).length ||
      (rk.commercial_risks || []).length ||
      (rk.timeline_risks || []).length ||
      (rk.compliance_risks || []).length ||
      (rk.conflicts || []).length ||
      (combined.clarifications || []).length;
    return !(anyStr || anyArr);
  }, [combined]);

  return (
    <div style={styles.page}>
      {/* lightweight responsive rule */}
      <style>
        {`
          @media (max-width: 980px) {
            .homeGrid { grid-template-columns: 1fr !important; }
          }
        `}
      </style>

      <div style={styles.topbar}>
        <div style={styles.topbarInner}>
          <div>
            <h1 style={styles.title}>Tender Bidding Summary</h1>
            <p style={styles.meta}>
              {user?.email ? user.email : "—"} {user?.role ? `• ${user.role}` : ""}
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={styles.pill}>
              Session: <b style={{ color: "#f9fafb" }}>{busy ? "Busy" : "Ready"}</b>
            </span>
            <button onClick={onLogout} style={styles.btn}>
              Logout
            </button>
          </div>
        </div>
      </div>

      <div style={styles.container}>
        {toast ? (
          <div style={{ ...styles.pill, position: "fixed", right: 16, bottom: 16, zIndex: 50, background: "rgba(2,6,23,0.75)" }}>
            {toast}
          </div>
        ) : null}

        <div className="homeGrid" style={styles.grid}>
          {/* Upload */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Upload</h3>
            <p style={styles.cardSub}>Upload multiple tender files and generate ONE consolidated EPC bidding summary.</p>

            <div style={styles.drop}>
              <div style={{ fontSize: 12.5, color: "#cbd5e1", fontWeight: 750 }}>Tender files</div>
              <div style={{ marginTop: 6, fontSize: 12.5, color: "#9ca3af" }}>
                Allowed: PDF / DOC / DOCX / TXT. Upload all parts (NIT, GCC/SCC, BOQ, Specs, Drawings list, Addenda).
              </div>

              <input
                style={styles.file}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.txt"
                onChange={(e) => onPickFiles(e.target.files)}
                disabled={busy}
              />

              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <span style={styles.pill}>
                  Files: <b style={{ color: "#f9fafb" }}>{files.length}</b>
                </span>
                <span style={styles.pill}>
                  Output: <b style={{ color: "#f9fafb" }}>Excel-ready + JSON</b>
                </span>
                <span style={styles.pill}>
                  Decision: <b style={{ color: "#f9fafb" }}>{combined ? bidDecision.decision : "—"}</b>
                </span>
              </div>
            </div>

            <div style={styles.btnRow}>
              <button
                onClick={onCreateCombinedSummary}
                disabled={!canSubmit || busy}
                style={{ ...styles.btn, ...((!canSubmit || busy) ? styles.btnDisabled : {}) }}
              >
                {busy ? "Working..." : "Create Summary"}
              </button>

              <button
                onClick={() => {
                  setFiles([]);
                  setItems([]);
                  setCombined(null);
                  setCombinedMeta(null);
                  setGlobalError("");
                  setSearchQuery("");
                }}
                disabled={busy}
                style={{ ...styles.btn, ...styles.btnSecondary, ...(busy ? styles.btnDisabled : {}) }}
              >
                Clear
              </button>

              <button
                onClick={() => {
                  if (!combined) return;
                  exportSummaryToExcelXml(combined, combinedMeta);
                  showToast("Excel export started.");
                }}
                disabled={!combined || busy}
                style={{ ...styles.btn, ...((!combined || busy) ? styles.btnDisabled : {}) }}
              >
                Export Excel
              </button>

              <button
                onClick={() => {
                  if (!combined) return;
                  downloadJson(combined, combinedMeta);
                  showToast("JSON downloaded.");
                }}
                disabled={!combined || busy}
                style={{ ...styles.btn, ...styles.btnSecondary, ...((!combined || busy) ? styles.btnDisabled : {}) }}
              >
                Download JSON
              </button>

              <button
                onClick={async () => {
                  if (!combined) return;
                  const text = JSON.stringify(combined, null, 2);
                  await copyToClipboard(text);
                  showToast("Summary JSON copied.");
                }}
                disabled={!combined || busy}
                style={{ ...styles.btn, ...styles.btnSecondary, ...((!combined || busy) ? styles.btnDisabled : {}) }}
              >
                Copy JSON
              </button>
            </div>

            {globalError ? <div style={styles.err}>{globalError}</div> : null}

            <div style={{ marginTop: 12 }}>
              <h4 style={styles.sectionTitle}>Files status</h4>
              <div style={styles.list}>
                {items.map((it) => {
                  const pct = statusProgress(it.status);
                  return (
                    <div key={it.id} style={styles.item}>
                      <div style={styles.itemTop}>
                        <div>
                          <p style={styles.fileName}>{it.fileName}</p>
                          <p style={styles.fileMeta}>
                            {it.sizeKb} KB • {statusLabel(it.status)}
                          </p>
                        </div>
                        <span style={styles.pill}>
                          <b style={{ color: "#f9fafb" }}>{statusLabel(it.status)}</b>
                        </span>
                      </div>

                      <div style={styles.barWrap}>
                        <div style={{ ...styles.bar, width: `${pct}%` }} />
                      </div>

                      {it.status === "error" && it.error ? <div style={styles.err}>{it.error}</div> : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={styles.section}>
              <h4 style={styles.sectionTitle}>Practical note</h4>
              <p style={styles.text}>
                This is an extracted summary. Treat it like a first-pass “assistant.” Your bid/no-bid decision should still be validated against
                the tender documents and portal entries (dates, corrigenda, clause wording, BOQ).
              </p>
            </div>
          </div>

          {/* Summary */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Summary</h3>
            <p style={styles.cardSub}>Consolidated bidding summary across all uploaded files.</p>

            {!combined ? (
              <p style={styles.text}>{combinedMeta?.fileCount ? "Generating..." : 'Upload tenders and click "Create Summary".'}</p>
            ) : (
              <>
                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <span style={styles.pill}>
                    Files analyzed: <b style={{ color: "#f9fafb" }}>{combinedMeta?.fileCount ?? "—"}</b>
                  </span>
                  <span style={styles.pill}>
                    Chars: <b style={{ color: "#f9fafb" }}>{combinedMeta?.totalChars ?? "—"}</b>
                  </span>
                  <span style={styles.pill}>
                    Bid score: <b style={{ color: "#f9fafb" }}>{bidDecision.score}</b>/100
                  </span>
                </div>

                {/* Summary toolbar */}
                <div style={styles.summaryToolbar}>
                  <input
                    style={styles.search}
                    placeholder="Search inside extracted summary (e.g., EMD, LD, PBG, validity, warranty, scope)…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    disabled={busy}
                  />
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button
                      style={{ ...styles.btn, ...styles.btnSecondary }}
                      onClick={() => {
                        setSearchQuery("");
                        showToast("Search cleared.");
                      }}
                      disabled={busy}
                    >
                      Clear Search
                    </button>

                    <button
                      style={{ ...styles.btn, ...styles.btnSecondary }}
                      onClick={() => {
                        if (!combined) return;
                        const text =
                          `Tender: ${safeStr(combined.basic_info?.tender_title)}\n` +
                          `Client: ${safeStr(combined.basic_info?.client)}\n` +
                          `Location: ${safeStr(combined.basic_info?.project_location)}\n` +
                          `Submission: ${safeStr(combined.basic_info?.bid_submission_deadline)}\n` +
                          `Decision: ${bidDecision.decision} (${bidDecision.score}/100)\n` +
                          `Top risks: ${(combined.risk_analysis?.compliance_risks || []).slice(0, 2).concat((combined.risk_analysis?.commercial_risks || []).slice(0, 2)).filter(Boolean).join(" | ") || "—"}`;
                        copyToClipboard(text).then(() => showToast("Executive snapshot copied."));
                      }}
                      disabled={busy}
                    >
                      Copy Snapshot
                    </button>
                  </div>
                </div>

                {searchWarn ? <div style={styles.warn}>{searchWarn}</div> : null}
                {isEmptySummary ? (
                  <div style={styles.warn}>
                    The analyzer returned an empty/near-empty summary_json. This usually means the extractor didn’t pick text from the files
                    (scanned PDF, images-only, protected doc) or content types were unsupported. Fix: ensure text-based PDFs or run OCR server-side.
                  </div>
                ) : null}

                {/* Bid/No-Bid Decision */}
                <Accordion
                  title="Bid / No-Bid Decision"
                  defaultOpen
                  rightSlot={<span style={styles.pill}>{bidDecision.decision}</span>}
                >
                  <div style={styles.decisionRow}>
                    <div>
                      <p style={{ ...styles.text, marginTop: 0 }}>
                        This is a client-side governance heuristic from extracted risks/eligibility/commercial flags. Use it as a prioritization lens,
                        not as gospel.
                      </p>

                      <div style={styles.section}>
                        <h4 style={styles.sectionTitle}>Rationale</h4>
                        {renderList(bidDecision.rationale, searchQuery)}
                      </div>

                      <div style={styles.section}>
                        <h4 style={styles.sectionTitle}>Immediate Actions</h4>
                        {renderList(bidDecision.actions, searchQuery)}
                      </div>
                    </div>

                    <div style={styles.scoreBox}>
                      <p style={styles.score}>{bidDecision.score}</p>
                      <p style={styles.scoreMeta}>Bid Score (0–100)</p>
                      <div style={{ ...styles.barWrap, marginTop: 10 }}>
                        <div style={{ ...styles.bar, width: `${bidDecision.score}%` }} />
                      </div>
                      <p style={{ ...styles.scoreMeta, marginTop: 10 }}>
                        {bidDecision.decision}
                      </p>
                    </div>
                  </div>
                </Accordion>

                {/* Basic Info */}
                <Accordion title="Basic Information" defaultOpen>
                  <div style={styles.kvGrid}>
                    <KV k="Tender Title" v={combined.basic_info?.tender_title ?? null} />
                    <KV k="Client" v={combined.basic_info?.client ?? null} />
                    <KV k="Bid No" v={combined.basic_info?.bid_no ?? null} />
                    <KV k="Tender ID" v={combined.basic_info?.tender_id ?? null} />
                    <KV k="RFP No" v={combined.basic_info?.rfp_no ?? null} />
                    <KV k="Project Location" v={combined.basic_info?.project_location ?? null} />
                    <KV k="Capacity (MW)" v={combined.basic_info?.capacity_mw ?? null} />
                    <KV k="Tender Fee" v={combined.basic_info?.tender_fee ?? null} />
                    <KV k="EMD" v={combined.basic_info?.emd ?? null} />
                    <KV k="Bid Submission Deadline" v={combined.basic_info?.bid_submission_deadline ?? null} />
                    <KV k="Bid Opening Date" v={combined.basic_info?.bid_opening_date ?? null} />
                    <KV k="Bid Validity" v={combined.basic_info?.bid_validity ?? null} />
                    <KV k="Completion Period" v={combined.basic_info?.completion_period ?? null} />
                    <KV k="Contract Type" v={combined.basic_info?.contract_type ?? null} />
                  </div>
                </Accordion>

                {/* Scope */}
                <Accordion title="Scope Summary" defaultOpen>
                  <p style={{ ...styles.text, marginTop: 0 }}>{combined.scope_summary?.overview ?? "—"}</p>

                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Major Supply</h4>
                    {renderList(combined.scope_summary?.major_supply, searchQuery)}
                  </div>
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Civil Scope</h4>
                    {renderList(combined.scope_summary?.civil_scope, searchQuery)}
                  </div>
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Electrical Scope</h4>
                    {renderList(combined.scope_summary?.electrical_scope, searchQuery)}
                  </div>
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Testing & Commissioning</h4>
                    {renderList(combined.scope_summary?.testing_commissioning, searchQuery)}
                  </div>
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Exclusions</h4>
                    {renderList(combined.scope_summary?.exclusions, searchQuery)}
                  </div>
                </Accordion>

                {/* Eligibility */}
                <Accordion title="Eligibility" defaultOpen>
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Financial</h4>
                    {renderList(combined.eligibility?.financial, searchQuery)}
                  </div>
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Technical Experience</h4>
                    {renderList(combined.eligibility?.technical_experience, searchQuery)}
                  </div>
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>OEM Requirements</h4>
                    {renderList(combined.eligibility?.oem_requirements, searchQuery)}
                  </div>
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Certifications</h4>
                    {renderList(combined.eligibility?.certifications, searchQuery)}
                  </div>
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Other Conditions</h4>
                    {renderList(combined.eligibility?.other_conditions, searchQuery)}
                  </div>
                </Accordion>

                {/* Commercial */}
                <Accordion title="Commercial Terms" defaultOpen>
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Payment Terms</h4>
                    {renderList(combined.commercial_terms?.payment_terms, searchQuery)}
                  </div>

                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Key Clauses</h4>
                    <div style={styles.kvGrid}>
                      <KV k="LD Clause" v={combined.commercial_terms?.ld_clause ?? null} />
                      <KV k="Performance Guarantee" v={combined.commercial_terms?.performance_guarantee ?? null} />
                      <KV k="Defect Liability" v={combined.commercial_terms?.defect_liability ?? null} />
                      <KV k="Price Adjustment" v={combined.commercial_terms?.price_adjustment ?? null} />
                      <KV k="Warranty" v={combined.commercial_terms?.warranty ?? null} />
                      <KV k="Taxes & Duties" v={combined.commercial_terms?.taxes_duties ?? null} />
                      <KV k="Insurance" v={combined.commercial_terms?.insurance ?? null} />
                    </div>
                  </div>
                </Accordion>

                {/* Evaluation */}
                <Accordion title="Evaluation" defaultOpen>
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Technical Evaluation</h4>
                    {renderList(combined.evaluation?.technical_evaluation, searchQuery)}
                  </div>
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Commercial Evaluation</h4>
                    {renderList(combined.evaluation?.commercial_evaluation, searchQuery)}
                  </div>
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Award Basis</h4>
                    <p style={styles.text}>{combined.evaluation?.award_basis ?? "—"}</p>
                  </div>
                </Accordion>

                {/* Risks */}
                <Accordion title="Risk Analysis" defaultOpen>
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Technical Risks</h4>
                    {renderList(combined.risk_analysis?.technical_risks, searchQuery)}
                  </div>
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Commercial Risks</h4>
                    {renderList(combined.risk_analysis?.commercial_risks, searchQuery)}
                  </div>
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Timeline Risks</h4>
                    {renderList(combined.risk_analysis?.timeline_risks, searchQuery)}
                  </div>
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Compliance Risks</h4>
                    {renderList(combined.risk_analysis?.compliance_risks, searchQuery)}
                  </div>
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Conflicts Across Documents</h4>
                    {renderList(combined.risk_analysis?.conflicts, searchQuery)}
                  </div>
                </Accordion>

                {/* Clarifications */}
                <Accordion title="Clarifications" defaultOpen>
                  {renderList(combined.clarifications, searchQuery)}
                </Accordion>

                {/* Integrity note */}
                <div style={styles.section}>
                  <h4 style={styles.sectionTitle}>Data Integrity Checks</h4>
                  <ul style={styles.ul}>
                    <li style={styles.li}>
                      If tender PDFs are scanned (images-only), extraction will be weak. Use text-based PDFs or add OCR server-side.
                    </li>
                    <li style={styles.li}>
                      If you see “—” for dates/fees/EMD, confirm from tender portal and corrigenda. Don’t assume it’s absent.
                    </li>
                    <li style={styles.li}>
                      Export Excel includes: Meta, Bid Decision, Basic Info, Scope, Eligibility, Commercial, Evaluation, Risks, Clarifications.
                    </li>
                  </ul>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}