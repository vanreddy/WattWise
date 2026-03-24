"use client";

import { useState, useCallback, useMemo } from "react";
import { useSwipeable } from "react-swipeable";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { DailySummary, HourlyBucket } from "@/lib/api";
import type { DateRange } from "@/hooks/useDashboardData";
import PeriodSelector, { computeRange, type Mode } from "@/components/PeriodSelector";
import CostTiles from "@/components/CostTiles";

interface Props {
  daily: DailySummary[];
  hourly: HourlyBucket[];
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
}

function fmt(v: number): string {
  return `$${v.toFixed(1)}`;
}

function formatDay(day: string): string {
  const d = new Date(day + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatHour(hour: string): string {
  const d = new Date(hour);
  return d.toLocaleTimeString("en-US", { hour: "numeric", hour12: true });
}

export default function SavingsTab({ daily, hourly, dateRange, setDateRange }: Props) {
  const [mode, setMode] = useState<Mode>("daily");
  const [offset, setOffset] = useState(0);
  const [swipeDir, setSwipeDir] = useState<"left" | "right" | null>(null);

  const navigate = useCallback(
    (dir: -1 | 1) => {
      const newOffset = offset + dir;
      if (newOffset > 0) return;
      setOffset(newOffset);
      setSwipeDir(dir === -1 ? "right" : "left");
      const range = computeRange(mode, newOffset);
      setDateRange(range);
      setTimeout(() => setSwipeDir(null), 300);
    },
    [mode, offset, setDateRange]
  );

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => navigate(-1),
    onSwipedRight: () => navigate(1),
    trackMouse: false,
    delta: 50,
  });

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    setOffset(0);
  };

  const handlePeriodChange = (range: DateRange) => {
    setDateRange(range);
  };

  const isDaily = mode === "daily" || dateRange.days === 1;

  // Compute average rate from daily data for hourly cost estimation
  const avgRate = useMemo(() => {
    let totalImport = 0;
    let totalCost = 0;
    for (const d of daily) {
      totalImport += d.total_import_kwh;
      totalCost += d.total_cost;
    }
    return totalImport > 0 ? totalCost / totalImport : 0.33;
  }, [daily]);

  // Hourly chart data for daily mode (sorted ascending by hour)
  const hourlyCostData = useMemo(() => {
    if (!isDaily || hourly.length === 0) return [];
    return [...hourly]
      .sort((a, b) => new Date(a.hour).getTime() - new Date(b.hour).getTime())
      .map((h) => ({
        label: formatHour(h.hour),
        Cost: parseFloat((h.grid_import_kwh * avgRate).toFixed(1)),
      }));
  }, [isDaily, hourly, avgRate]);

  const hourlySavingsData = useMemo(() => {
    if (!isDaily || hourly.length === 0) return [];
    return [...hourly]
      .sort((a, b) => new Date(a.hour).getTime() - new Date(b.hour).getTime())
      .map((h) => {
        const solarDirectUse = Math.max(0, h.solar_kwh - h.grid_export_kwh - h.battery_charge_kwh);
        const solarSavings = solarDirectUse * avgRate;
        const batterySavings = h.battery_discharge_kwh * avgRate;
        const exportCredits = h.grid_export_kwh * avgRate * 0.25;
        return {
          label: formatHour(h.hour),
          "Self-Power": parseFloat(solarSavings.toFixed(1)),
          Battery: parseFloat(batterySavings.toFixed(1)),
          "Export Credits": parseFloat(exportCredits.toFixed(1)),
        };
      });
  }, [isDaily, hourly, avgRate]);

  // Multi-day chart data (sorted ascending by date)
  const costData = useMemo(() => {
    return [...daily]
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => ({
        label: formatDay(d.day),
        Peak: parseFloat(d.peak_cost.toFixed(1)),
        "Part-Peak": parseFloat(d.part_peak_cost.toFixed(1)),
        "Off-Peak": parseFloat(d.off_peak_cost.toFixed(1)),
      }));
  }, [daily]);

  const savingsData = useMemo(() => {
    return [...daily]
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => {
        const rate = d.total_import_kwh > 0 ? d.total_cost / d.total_import_kwh : 0.33;
        const totalSavings = d.solar_self_consumed_kwh * rate;
        const exportCredit = d.export_credit;
        const solarRatio = 0.6;
        const solarDirect = totalSavings * solarRatio;
        const batterySavings = totalSavings * (1 - solarRatio);

        return {
          label: formatDay(d.day),
          "Self-Power": parseFloat(solarDirect.toFixed(1)),
          Battery: parseFloat(batterySavings.toFixed(1)),
          "Export Credits": parseFloat(exportCredit.toFixed(1)),
        };
      });
  }, [daily]);

  const showMultiDayCharts = !isDaily && daily.length > 1;
  const showHourlyCharts = isDaily && hourly.length > 0;

  // Compute shared Y-axis max for normalized axes
  const sharedMax = useMemo(() => {
    let max = 0;
    if (showHourlyCharts) {
      for (const d of hourlySavingsData) {
        const total = (d["Self-Power"] || 0) + (d.Battery || 0) + (d["Export Credits"] || 0);
        if (total > max) max = total;
      }
      for (const d of hourlyCostData) {
        if (d.Cost > max) max = d.Cost;
      }
    }
    if (showMultiDayCharts) {
      for (const d of savingsData) {
        const total = (d["Self-Power"] || 0) + (d.Battery || 0) + (d["Export Credits"] || 0);
        if (total > max) max = total;
      }
      for (const d of costData) {
        const total = (d.Peak || 0) + (d["Part-Peak"] || 0) + (d["Off-Peak"] || 0);
        if (total > max) max = total;
      }
    }
    return Math.ceil(max * 1.1 * 10) / 10; // 10% headroom, round to 1 decimal
  }, [showHourlyCharts, showMultiDayCharts, hourlySavingsData, hourlyCostData, savingsData, costData]);

  const tooltipStyle = {
    contentStyle: { backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 12 },
    labelStyle: { color: "#9ca3af" },
  };

  const chartHeight = 220;

  return (
    <div className="space-y-4">
      {/* Period selector — sticky while scrolling */}
      <div className="sticky top-0 z-20 bg-gray-950 pb-2 -mx-3 px-3 sm:-mx-4 sm:px-4">
        <PeriodSelector
          value={dateRange}
          onChange={handlePeriodChange}
          onModeChange={handleModeChange}
        />
      </div>

      <div
        {...swipeHandlers}
        className={`transition-transform duration-300 ease-out ${
          swipeDir === "left"
            ? "-translate-x-2"
            : swipeDir === "right"
              ? "translate-x-2"
              : "translate-x-0"
        }`}
      >
        <div className="space-y-4">
          {/* Cost tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <CostTiles data={daily} days={dateRange.days} />
          </div>

          {/* === Hourly charts (daily mode) === */}
          {showHourlyCharts && (
            <>
              <div className="bg-gray-900 rounded-xl p-3 sm:p-4 border border-gray-800">
                <h2 className="text-sm font-semibold text-gray-400 mb-2">Self-Power Savings</h2>
                <ResponsiveContainer width="100%" height={chartHeight}>
                  <BarChart data={hourlySavingsData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="label" tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={{ stroke: "#374151" }} tickLine={false} />
                    <YAxis domain={[0, sharedMax]} tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v.toFixed(1)}`} />
                    <Tooltip {...tooltipStyle} formatter={(value: number) => fmt(value)} />
                    <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                    <Bar dataKey="Self-Power" stackId="savings" fill="#166534" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Battery" stackId="savings" fill="#4ade80" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Export Credits" stackId="savings" fill="#6b7280" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-gray-900 rounded-xl p-3 sm:p-4 border border-gray-800">
                <h2 className="text-sm font-semibold text-gray-400 mb-2">Grid Costs</h2>
                <ResponsiveContainer width="100%" height={chartHeight}>
                  <BarChart data={hourlyCostData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="label" tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={{ stroke: "#374151" }} tickLine={false} />
                    <YAxis domain={[0, sharedMax]} tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v.toFixed(1)}`} />
                    <Tooltip {...tooltipStyle} formatter={(value: number) => fmt(value)} />
                    <Bar dataKey="Cost" fill="#ef4444" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {/* === Multi-day charts (weekly/monthly/yearly) === */}
          {showMultiDayCharts && (
            <>
              <div className="bg-gray-900 rounded-xl p-3 sm:p-4 border border-gray-800">
                <h2 className="text-sm font-semibold text-gray-400 mb-2">Self-Power Savings</h2>
                <ResponsiveContainer width="100%" height={chartHeight}>
                  <BarChart data={savingsData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="label" tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={{ stroke: "#374151" }} tickLine={false} />
                    <YAxis domain={[0, sharedMax]} tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v.toFixed(1)}`} />
                    <Tooltip {...tooltipStyle} formatter={(value: number) => fmt(value)} />
                    <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                    <Bar dataKey="Self-Power" stackId="savings" fill="#166534" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Battery" stackId="savings" fill="#4ade80" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Export Credits" stackId="savings" fill="#6b7280" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-gray-900 rounded-xl p-3 sm:p-4 border border-gray-800">
                <h2 className="text-sm font-semibold text-gray-400 mb-2">Grid Cost Breakdown</h2>
                <ResponsiveContainer width="100%" height={chartHeight}>
                  <BarChart data={costData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="label" tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={{ stroke: "#374151" }} tickLine={false} />
                    <YAxis domain={[0, sharedMax]} tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v.toFixed(1)}`} />
                    <Tooltip {...tooltipStyle} formatter={(value: number) => fmt(value)} />
                    <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                    <Bar dataKey="Peak" stackId="cost" fill="#ef4444" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Part-Peak" stackId="cost" fill="#f87171" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Off-Peak" stackId="cost" fill="#fca5a5" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
