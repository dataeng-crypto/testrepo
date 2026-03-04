// src/pages/Login.tsx
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../services/auth";

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: 20,
    background: "linear-gradient(180deg, #0b1220 0%, #0f172a 45%, #111827 100%)",
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial",
    color: "#e5e7eb",
  },
  shell: {
    width: "100%",
    maxWidth: 440,
    padding: 18,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  logo: {
    width: 42,
    height: 42,
    borderRadius: 12,
    background: "linear-gradient(135deg, #2563eb 0%, #06b6d4 100%)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
  },
  titleWrap: { display: "grid", gap: 2 },
  title: { margin: 0, fontSize: 22, fontWeight: 750, letterSpacing: 0.2 },
  subtitle: { margin: 0, fontSize: 13.5, color: "#9ca3af" },

  card: {
    background: "rgba(17, 24, 39, 0.75)",
    border: "1px solid rgba(148,163,184,0.15)",
    borderRadius: 16,
    padding: 18,
    boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
    backdropFilter: "blur(10px)",
  },
  form: { display: "grid", gap: 12 },
  label: { fontSize: 12.5, color: "#cbd5e1", fontWeight: 650, letterSpacing: 0.2 },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,0.18)",
    background: "rgba(2,6,23,0.45)",
    color: "#e5e7eb",
    outline: "none",
    fontSize: 14,
  },
  row: { display: "grid", gap: 6 },
  button: {
    marginTop: 4,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,0.18)",
    background: "linear-gradient(180deg, #1f2937 0%, #111827 100%)",
    color: "#f9fafb",
    fontWeight: 700,
    cursor: "pointer",
  },
  buttonDisabled: { opacity: 0.6, cursor: "not-allowed" as const },
  err: {
    marginTop: 8,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(239,68,68,0.35)",
    background: "rgba(239,68,68,0.10)",
    color: "#fecaca",
    fontSize: 13.5,
    lineHeight: 1.35,
  },
  footer: {
    marginTop: 12,
    color: "#94a3b8",
    fontSize: 12.5,
    textAlign: "center" as const,
  },
};

export default function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>("");

  const canSubmit = useMemo(() => email.trim() && password.trim(), [email, password]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);

    try {
      const res = await login({ email, password });
      if (!res.ok) {
        setErr(res.error || "Login failed.");
        return;
      }
      nav("/", { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.brand}>
          <div style={styles.logo} />
          <div style={styles.titleWrap}>
            <h1 style={styles.title}>Tender Intelligence</h1>
            <p style={styles.subtitle}>Secure access to tender upload and analysis</p>
          </div>
        </div>

        <div style={styles.card}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 750, color: "#f9fafb" }}>Sign in</h2>
          <p style={{ marginTop: 6, marginBottom: 12, fontSize: 13.5, color: "#9ca3af" }}>
            Use your authorized email and password.
          </p>

          <form onSubmit={onSubmit} style={styles.form}>
            <div style={styles.row}>
              <div style={styles.label}>Email</div>
              <input
                style={styles.input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                autoComplete="username"
              />
            </div>

            <div style={styles.row}>
              <div style={styles.label}>Password</div>
              <input
                style={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                type="password"
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={!canSubmit || busy}
              style={{ ...styles.button, ...((!canSubmit || busy) ? styles.buttonDisabled : {}) }}
            >
              {busy ? "Signing in..." : "Sign in"}
            </button>

            {err ? <div style={styles.err}>{err}</div> : null}
          </form>
        </div>

        <div style={styles.footer}>© {new Date().getFullYear()} Rays Power Infra • Internal Use</div>
      </div>
    </div>
  );
}