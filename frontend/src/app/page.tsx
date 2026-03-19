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
import BatteryGauge from "@/components/BatteryGauge";
import AlertsList from "@/components/AlertsList";

const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

export default function Dashboard() {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [daily, setDaily] = useState<DailySummary[]>([]);
  const [hourly, setHourly] = useState<HourlyBucket[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [s, d, h, a] = await Promise.all([
        api.getSummary(),
        api.getDaily(),
        api.getHourly(),
        api.getAlerts(5),
      ]);
      setSummary(s);
      setDaily(d);
      setHourly(h);
      setAlerts(a);
      setError(null);
      setLastUpdated(new Date());
    } catch (e) {
      // Fall back to mock data when API is unavailable
      setSummary(mockSummary);
      setDaily(mockDaily);
      setHourly(mockHourly);
      setAlerts(mockAlerts);
      setError(e instanceof Error ? e.message : "Failed to fetch data");
      setLastUpdated(new Date());
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchAll]);

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

      {/* Live power flows */}
      <PowerFlowCards current={summary.current} today={summary.today} />

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <HourlyChart data={hourly} />
        </div>
        <BatteryGauge
          batteryPct={summary.current.battery_pct}
          dailyData={daily}
        />
      </div>

      {/* Cost + Alerts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <CostBarChart data={daily.slice(0, 7)} />
        </div>
        <AlertsList alerts={alerts} />
      </div>

      {/* Today's cost breakdown */}
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <h2 className="text-sm font-semibold text-gray-400 mb-3">
          Today&apos;s Cost Breakdown
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Total</span>
            <p className="text-lg font-bold text-white">
              ${summary.today.total_cost.toFixed(2)}
            </p>
          </div>
          <div>
            <span className="text-gray-500">Peak</span>
            <p className="text-lg font-bold text-red-400">
              ${summary.today.peak_cost.toFixed(2)}
            </p>
          </div>
          <div>
            <span className="text-gray-500">Part Peak</span>
            <p className="text-lg font-bold text-yellow-400">
              ${summary.today.part_peak_cost.toFixed(2)}
            </p>
          </div>
          <div>
            <span className="text-gray-500">Off Peak</span>
            <p className="text-lg font-bold text-green-400">
              ${summary.today.off_peak_cost.toFixed(2)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
