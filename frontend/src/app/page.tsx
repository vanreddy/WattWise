"use client";

import { useEffect, useState, useCallback } from "react";
import {
  api,
  type SummaryResponse,
  type DailySummary,
  type HourlyBucket,
  type Alert,
} from "@/lib/api";
import {
  mockSummary,
  mockDaily,
  mockHourly,
  mockAlerts,
} from "@/lib/mock";
import PowerFlowCards from "@/components/PowerFlowCards";
import HourlyChart from "@/components/HourlyChart";
import CostBarChart from "@/components/CostBarChart";
import CostWaterfallChart from "@/components/CostWaterfallChart";
import AlertsList from "@/components/AlertsList";
import DateRangePicker, { type DateRange } from "@/components/DateRangePicker";
import SankeyChart from "@/components/SankeyChart";
import { Radio, BarChart3, Calendar } from "lucide-react";

const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

function todayStr() {
  // Use local date (PST), not UTC — toISOString() would give UTC which is wrong after 4/5pm Pacific
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function defaultRange(): DateRange {
  return { label: "Today", from: todayStr(), to: todayStr(), days: 1 };
}

export default function Dashboard() {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [daily, setDaily] = useState<DailySummary[]>([]);
  const [hourly, setHourly] = useState<HourlyBucket[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>(defaultRange);

  // Fetch summary + alerts (always current)
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

  // Fetch range-dependent data (hourly + daily)
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
      const d = await api.getDaily(range.from, range.to);
      setDaily(d);
    } catch {
      setDaily(mockDaily);
    }
  }, []);

  // Initial load + auto-refresh for live data
  useEffect(() => {
    fetchLive();
    const interval = setInterval(fetchLive, REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchLive]);

  // Fetch range data when range changes
  useEffect(() => {
    fetchRangeData(dateRange);
  }, [dateRange, fetchRangeData]);

  const handleRangeChange = (range: DateRange) => {
    setDateRange(range);
  };

  if (error && !summary) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400 text-lg mb-2">Unable to connect to API</p>
        <p className="text-gray-500 text-sm">{error}</p>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  const costTitle = `${dateRange.days}-Day Cost Breakdown`;

  return (
    <div className="space-y-6">
      {/* Status bar */}
      <div className="flex justify-between items-center text-xs text-gray-500">
        <span>
          {lastUpdated
            ? `Last updated ${lastUpdated.toLocaleTimeString()}`
            : ""}
        </span>
        {error && <span className="text-yellow-500">Refresh failed</span>}
      </div>

      {/* Live Stats heading */}
      <h2 className="text-sm font-semibold text-gray-400 flex items-center gap-1.5">
        <Radio size={14} className="text-green-400" />
        Live Stats
      </h2>

      {/* Live power flows */}
      <PowerFlowCards current={summary.current} today={summary.today} />

      {/* Date range selector */}
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-semibold text-gray-400 flex items-center gap-1.5">
          <BarChart3 size={14} className="text-blue-400" />
          Charts
        </h2>
        <DateRangePicker value={dateRange} onChange={handleRangeChange} />
      </div>

      {/* Energy Flow chart */}
      <HourlyChart data={hourly} days={dateRange.days} />

      {/* Sankey energy flow */}
      <SankeyChart hourlyData={hourly} dailyData={daily} days={dateRange.days} />

      {/* Cost Waterfall + Alerts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <CostWaterfallChart data={daily} days={dateRange.days} />
        </div>
        <AlertsList alerts={alerts} />
      </div>

      {/* Daily Cost Breakdown */}
      {dateRange.days > 1 && (
        <CostBarChart data={daily} title={costTitle} />
      )}
    </div>
  );
}
