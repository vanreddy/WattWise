import { getAccessToken, refreshAccessToken, clearTokens } from "./auth";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");

async function fetchJSON<T>(path: string): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res = await fetch(`${API_BASE}${path}`, { cache: "no-store", headers });

  if (res.status === 401 && token) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      res = await fetch(`${API_BASE}${path}`, { cache: "no-store", headers });
    }
  }

  if (res.status === 401) {
    clearTokens();
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  if (!res.ok) throw new Error(`API error: ${res.status} ${path}`);
  return res.json();
}

export interface CurrentPower {
  ts: string | null;
  solar_w: number;
  home_w: number;
  grid_w: number;
  battery_w: number;
  battery_pct: number;
  vehicle_w: number;
}

export interface TodayTotals {
  solar_generated_kwh: number;
  total_import_kwh: number;
  total_export_kwh: number;
  total_cost: number;
  peak_cost: number;
  part_peak_cost: number;
  off_peak_cost: number;
  export_credit: number;
}

export interface SummaryResponse {
  current: CurrentPower;
  today: TodayTotals;
}

export interface DailySummary {
  day: string;
  total_import_kwh: number;
  total_export_kwh: number;
  solar_generated_kwh: number;
  solar_self_consumed_kwh: number;
  peak_import_kwh: number;
  part_peak_import_kwh: number;
  off_peak_import_kwh: number;
  peak_cost: number;
  part_peak_cost: number;
  off_peak_cost: number;
  total_cost: number;
  export_credit: number;
  ev_kwh: number;
  ev_peak_kwh: number;
  ev_off_peak_kwh: number;
  ev_cost: number;
  battery_peak_coverage_pct: number | null;
  battery_depletion_hour: number | null;
  context_narrative: string | null;
  actions: string[];
}

export interface HourlyBucket {
  hour: string;
  solar_w_avg: number;
  home_w_avg: number;
  grid_w_avg: number;
  battery_w_avg: number;
  battery_pct_avg: number;
  vehicle_w_avg: number;
  // Per-interval energy sums (avoids within-hour sign cancellation)
  solar_kwh: number;
  grid_import_kwh: number;
  grid_export_kwh: number;
  battery_discharge_kwh: number;
  battery_charge_kwh: number;
  home_kwh: number;
}

export interface SankeyFlows {
  solar_to_home: number;
  solar_to_battery: number;
  solar_to_grid: number;
  battery_to_home: number;
  battery_to_grid: number;
  grid_to_home: number;
  grid_to_battery: number;
}

export interface SankeyResponse {
  flows: SankeyFlows;
  from: string;
  to: string;
}

export interface IntervalPoint {
  ts: string;
  solar_w: number;
  home_w: number;
  grid_w: number;
  battery_w: number;
  battery_pct: number;
  vehicle_w: number;
}

export interface Alert {
  id: number;
  fired_at: string;
  alert_type: string;
  message: string;
  metadata: Record<string, unknown> | null;
}

export interface Report {
  id: number;
  sent_at: string;
  report_type: string;
  covers_from: string;
  covers_to: string;
  subject: string;
  metadata: Record<string, unknown> | null;
}

export const api = {
  getSummary: () => fetchJSON<SummaryResponse>("/summary"),
  getDaily: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    return fetchJSON<DailySummary[]>(`/daily${qs ? `?${qs}` : ""}`);
  },
  getHourly: (date?: string) => {
    const qs = date ? `?date=${date}` : "";
    return fetchJSON<HourlyBucket[]>(`/hourly${qs}`);
  },
  getHourlyRange: (from: string, to: string): Promise<HourlyBucket[]> => {
    return fetchJSON<HourlyBucket[]>(`/hourly?from=${from}&to=${to}`);
  },
  getIntervals: (date?: string) => {
    const qs = date ? `?date=${date}` : "";
    return fetchJSON<IntervalPoint[]>(`/intervals${qs}`);
  },
  getIntervalsRange: (from: string, to: string): Promise<IntervalPoint[]> => {
    return fetchJSON<IntervalPoint[]>(`/intervals?from=${from}&to=${to}`);
  },
  getSankey: (date?: string, from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (date) params.set("date", date);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    return fetchJSON<SankeyResponse>(`/sankey${qs ? `?${qs}` : ""}`);
  },
  getAlerts: (limit = 50) => fetchJSON<Alert[]>(`/alerts?limit=${limit}`),
  getReports: (type?: string, limit = 10) => {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    params.set("limit", String(limit));
    return fetchJSON<Report[]>(`/reports?${params}`);
  },
};
