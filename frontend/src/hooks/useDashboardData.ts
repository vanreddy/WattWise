"use client";

import { useEffect, useState, useCallback } from "react";
import {
  api,
  type SummaryResponse,
  type DailySummary,
  type HourlyBucket,
  type Alert,
  type SankeyFlows,
  type IntervalPoint,
} from "@/lib/api";
import {
  mockSummary,
  mockDaily,
  mockHourly,
  mockAlerts,
} from "@/lib/mock";
import { getAccessToken } from "@/lib/auth";

const REFRESH_MS = 5 * 60 * 1000;
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");

export interface DateRange {
  label: string;
  from: string;
  to: string;
  days: number;
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function defaultRange(): DateRange {
  return { label: "Today", from: todayStr(), to: todayStr(), days: 1 };
}

export interface DashboardData {
  summary: SummaryResponse | null;
  daily: DailySummary[];
  hourly: HourlyBucket[];
  alerts: Alert[];
  intervalData: IntervalPoint[];
  sankeyFlows: SankeyFlows | null;
  error: string | null;
  lastUpdated: Date | null;
  backfillActive: boolean;
  backfillDays: number;
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  fetchLive: () => Promise<void>;
}

export function useDashboardData(): DashboardData {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [daily, setDaily] = useState<DailySummary[]>([]);
  const [hourly, setHourly] = useState<HourlyBucket[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [intervalData, setIntervalData] = useState<IntervalPoint[]>([]);
  const [sankeyFlows, setSankeyFlows] = useState<SankeyFlows | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [backfillActive, setBackfillActive] = useState(false);
  const [backfillDays, setBackfillDays] = useState(0);
  const [dateRange, setDateRange] = useState<DateRange>(defaultRange);

  // Detect backfill=active query param
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("backfill") !== "active") return;

    setBackfillActive(true);

    const pollBackfill = async () => {
      const token = getAccessToken();
      if (!token) return;
      try {
        const res = await fetch(`${API_BASE}/auth/account/backfill/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setBackfillDays(data.days_in_db || 0);
          if (data.status === "done") {
            setBackfillActive(false);
            window.history.replaceState({}, "", "/");
          }
        }
      } catch { /* ignore */ }
    };

    pollBackfill();
    const id = setInterval(pollBackfill, 10000);
    return () => clearInterval(id);
  }, []);

  const fetchLive = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        api.getSummary(),
        api.getAlerts(5),
      ]);
      setSummary(s);
      setAlerts(a);
      setError(null);
    } catch (e) {
      setSummary(mockSummary);
      setAlerts(mockAlerts);
      setError(e instanceof Error ? e.message : "Failed to fetch data");
    }
    setLastUpdated(new Date());
  }, []);

  const fetchRangeData = useCallback(async (range: DateRange) => {
    try {
      let h: HourlyBucket[];
      if (range.days === 1) {
        h = await api.getHourly(range.from);
      } else {
        h = await api.getHourlyRange(range.from, range.to);
      }
      setHourly(h);
    } catch {
      setHourly(mockHourly);
    }

    try {
      let iv: IntervalPoint[];
      if (range.days === 1) {
        iv = await api.getIntervals(range.from);
      } else {
        iv = await api.getIntervalsRange(range.from, range.to);
      }
      setIntervalData(iv);
    } catch {
      setIntervalData([]);
    }

    try {
      const d = await api.getDaily(range.from, range.to);
      setDaily(d);
    } catch {
      setDaily(mockDaily);
    }

    try {
      const sankey = await api.getSankey(
        range.days === 1 ? range.from : undefined,
        range.days > 1 ? range.from : undefined,
        range.days > 1 ? range.to : undefined,
      );
      setSankeyFlows(sankey.flows);
    } catch {
      setSankeyFlows(null);
    }
  }, []);

  // Auto-refresh live data
  useEffect(() => {
    fetchLive();
    const interval = setInterval(fetchLive, REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchLive]);

  // Fetch range data when range changes
  useEffect(() => {
    fetchRangeData(dateRange);
  }, [dateRange, fetchRangeData]);

  return {
    summary,
    daily,
    hourly,
    alerts,
    intervalData,
    sankeyFlows,
    error,
    lastUpdated,
    backfillActive,
    backfillDays,
    dateRange,
    setDateRange,
    fetchLive,
  };
}
