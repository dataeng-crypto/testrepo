// src/services/api.ts
import { getToken } from "./auth";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:7072/api";

export async function api<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = getToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };

  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`, {
    ...init,
    headers,
  });

  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && (data.error || data.message)) ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data as T;
}