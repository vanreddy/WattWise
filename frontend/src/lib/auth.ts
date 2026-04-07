const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");
const ACCESS_KEY = "ww_access_token";
const REFRESH_KEY = "ww_refresh_token";

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  account_id: string;
  site_name: string | null;
  energy_site_id: string | null;
  tesla_connected: boolean;
  nest_connected: boolean;
  smartcar_connected: boolean;
  zip_code: string | null;
  latitude: number | null;
  longitude: number | null;
  solar_capacity_kw: number | null;
  rate_plan_name: string | null;
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

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/auth/me/password`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to change password" }));
    throw new Error(err.detail || "Failed to change password");
  }
}

export async function disconnectTesla(): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/auth/account/tesla`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to disconnect Tesla" }));
    throw new Error(err.detail || "Failed to disconnect Tesla");
  }
}

// --------------- registration ---------------

export async function registerPrimary(
  email: string,
  password: string,
  teslaEmail?: string,
): Promise<{ user: AuthUser }> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, tesla_email: teslaEmail || null }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Registration failed" }));
    throw new Error(err.detail || "Registration failed");
  }

  const data = await res.json();
  setTokens(data.access_token, data.refresh_token);
  return { user: data.user };
}

export async function startTeslaAuth(): Promise<{
  authorization_url: string;
  state: string;
  code_verifier: string;
} | { status: string; message: string }> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/auth/tesla/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to start Tesla auth" }));
    throw new Error(err.detail || "Failed to start Tesla auth");
  }

  return res.json();
}

export async function completeTeslaAuth(
  redirectUrl: string,
  state: string,
  codeVerifier: string,
): Promise<{ status: string; site_name: string | null; energy_site_id: string | null }> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/auth/tesla/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      redirect_url: redirectUrl,
      state,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Tesla authentication failed" }));
    throw new Error(err.detail || "Tesla authentication failed");
  }

  return res.json();
}

// --------------- Nest (Google SDM) ---------------

export async function startNestAuth(): Promise<
  { authorization_url: string; state: string } | { status: string }
> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/nest/auth/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to start Nest auth" }));
    throw new Error(err.detail || "Failed to start Nest auth");
  }

  return res.json();
}

export async function completeNestAuth(code: string): Promise<{ status: string; devices: unknown[] }> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/nest/auth/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ code }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Nest authentication failed" }));
    throw new Error(err.detail || "Nest authentication failed");
  }

  return res.json();
}

export async function disconnectNest(): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/nest/disconnect`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to disconnect Nest" }));
    throw new Error(err.detail || "Failed to disconnect Nest");
  }
}

// --------------- Smartcar (BMW) ---------------

export async function startSmartcarAuth(): Promise<
  { authorization_url: string; state: string } | { status: string }
> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/smartcar/auth/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to start Smartcar auth" }));
    throw new Error(err.detail || "Failed to start Smartcar auth");
  }

  return res.json();
}

export async function completeSmartcarAuth(code: string): Promise<{ status: string; vehicles: unknown[] }> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/smartcar/auth/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ code }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Smartcar authentication failed" }));
    throw new Error(err.detail || "Smartcar authentication failed");
  }

  return res.json();
}

export async function disconnectSmartcar(): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/smartcar/disconnect`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to disconnect Smartcar" }));
    throw new Error(err.detail || "Failed to disconnect Smartcar");
  }
}
