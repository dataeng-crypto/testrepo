// src/services/auth.ts
import { api } from "./api";

export type LoginPayload = { email: string; password: string };
export type LoginResult =
  | { ok: true; token: string; email: string; role?: string }
  | { ok: false; error: string };

const TOKEN_KEY = "tender_token";
const USER_KEY = "tender_user";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getUser(): { email: string; role?: string } | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function setUser(user: { email: string; role?: string }) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/**
 * REAL login: calls Azure Function
 * POST /api/auth/login
 * expects: { ok:true, token:"...", email:"...", role:"..." }
 */
export async function login(payload: LoginPayload): Promise<LoginResult> {
  const email = payload.email.trim().toLowerCase();
  const password = payload.password;

  if (!email || !password) return { ok: false, error: "Email and password are required." };

  try {
    const res = await api<{ ok: boolean; token?: string; email?: string; role?: string; error?: string }>(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }
    );

    if (!res.ok || !res.token) {
      return { ok: false, error: res.error || "Login failed" };
    }

    setToken(res.token);
    setUser({ email: res.email || email, role: res.role });

    return { ok: true, token: res.token, email: res.email || email, role: res.role };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Login failed" };
  }
}

export async function logout(): Promise<void> {
  clearToken();
}