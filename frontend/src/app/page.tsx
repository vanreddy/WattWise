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
import PowerFlowCards from "@/components/PowerFlowCards";
import HourlyChart from "@/components/HourlyChart";
import CostWaterfallChart from "@/components/CostWaterfallChart";
import AlertsList from "@/components/AlertsList";
import DateRangePicker, { type DateRange } from "@/components/DateRangePicker";
import SankeyChart from "@/components/SankeyChart";
import SelfPoweredRing from "@/components/SelfPoweredRing";
import { Radio, BarChart3 } from "lucide-react";

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
  const [intervalData, setIntervalData] = useState<IntervalPoint[]>([]);
  const [sankeyFlows, setSankeyFlows] = useState<SankeyFlows | null>(null);
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

      {/* 1. Live view */}
      <h2 className="text-sm font-semibold text-gray-400 flex items-center gap-1.5">
        <Radio size={14} className="text-green-400" />
        Live Stats
      </h2>
      <PowerFlowCards current={summary.current} today={summary.today} />

      {/* 2. Date selector */}
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-semibold text-gray-400 flex items-center gap-1.5">
          <BarChart3 size={14} className="text-blue-400" />
          Charts
        </h2>
        <DateRangePicker value={dateRange} onChange={handleRangeChange} />
      </div>

      {/* 3. Self-powered + 4. Cost Waterfall + Alerts */}
      {(() => {
        let gridImport = 0;
        let totalConsumption = 0;
        if (sankeyFlows) {
          gridImport = sankeyFlows.grid_to_home + sankeyFlows.grid_to_battery;
          totalConsumption = sankeyFlows.solar_to_home + sankeyFlows.battery_to_home + sankeyFlows.grid_to_home;
        } else if (daily.length > 0) {
          gridImport = daily.reduce((s, d) => s + d.total_import_kwh, 0);
          const solar = daily.reduce((s, d) => s + d.solar_generated_kwh, 0);
          const exp = daily.reduce((s, d) => s + d.total_export_kwh, 0);
          totalConsumption = gridImport + solar - exp;
        }
        const selfPoweredPct = totalConsumption > 0
          ? Math.max(0, (1 - gridImport / totalConsumption) * 100)
          : 0;
        return (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <SelfPoweredRing selfPoweredPct={selfPoweredPct} />
            <div className="lg:col-span-2">
              <CostWaterfallChart data={daily} days={dateRange.days} />
            </div>
          </div>
        );
      })()}

      {/* 5. Sankey diagram */}
      <SankeyChart hourlyData={hourly} dailyData={daily} days={dateRange.days} sankeyFlows={sankeyFlows} />

      {/* 6. 24-hour energy flow */}
      <HourlyChart data={hourly} days={dateRange.days} intervalData={intervalData} />

      {/* Alerts */}
      <AlertsList alerts={alerts} />

    </div>
  );
}
