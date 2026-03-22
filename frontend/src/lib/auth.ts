const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");
const ACCESS_KEY = "ww_access_token";
const REFRESH_KEY = "ww_refresh_token";

export interface AuthUser {
  id: string;
  email: string;
  role: "primary" | "secondary";
  account_id: string;
  telegram_chat_id: string | null;
}

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export async function refreshAccessToken(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });

    if (!res.ok) {
      clearTokens();
      return null;
    }

    const data = await res.json();
    setTokens(data.access_token, data.refresh_token || refresh);
    return data.access_token;
  } catch {
    clearTokens();
    return null;
  }
}

export async function login(email: string, password: string): Promise<{ user: AuthUser }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Login failed" }));
    throw new Error(err.detail || "Login failed");
  }

  const data = await res.json();
  setTokens(data.access_token, data.refresh_token);
  return { user: data.user };
}

export async function fetchMe(): Promise<AuthUser | null> {
  const token = getAccessToken();
  if (!token) return null;

  let res = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (!newToken) return null;
    res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${newToken}` },
    });
  }

  if (!res.ok) return null;
  return res.json();
}

export function logout() {
  clearTokens();
  window.location.href = "/login";
}

// --------------- invite & register helpers ---------------

export async function createInvite(email: string): Promise<{ invite_id: string }> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/auth/invite`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ email }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to create invite" }));
    throw new Error(err.detail || "Failed to create invite");
  }

  return res.json();
}

export async function linkTelegram(code: string): Promise<{ telegram_chat_id: string }> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/auth/me/telegram/link`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ code }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to link Telegram" }));
    throw new Error(err.detail || "Failed to link Telegram");
  }

  return res.json();
}

export async function unlinkTelegram(): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/auth/me/telegram`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to unlink Telegram" }));
    throw new Error(err.detail || "Failed to unlink Telegram");
  }
}

export async function register(
  email: string,
  password: string,
  invite_token: string,
): Promise<{ user: AuthUser }> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, invite_token }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Registration failed" }));
    throw new Error(err.detail || "Registration failed");
  }

  const data = await res.json();
  setTokens(data.access_token, data.refresh_token);
  return { user: data.user };
}
