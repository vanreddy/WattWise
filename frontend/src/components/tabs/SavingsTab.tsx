"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
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
import { Sun, Zap } from "lucide-react";
import type { DailySummary, HourlyBucket, SankeyFlows, RateScheduleEntry } from "@/lib/api";
import { api } from "@/lib/api";
import type { DateRange } from "@/hooks/useDashboardData";
import PeriodSelector, { computeRange, type Mode } from "@/components/PeriodSelector";

interface Props {
  daily: DailySummary[];
  hourly: HourlyBucket[];
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  sankeyFlows?: SankeyFlows | null;
}

/* ─── Tick-up hook ─── */

function useTickUp(target: number, duration = 1000, delay = 0): number {
  const [value, setValue] = useState(0);
  const startTime = useRef<number | null>(null);

  useEffect(() => {
    if (target <= 0) { setValue(0); return; }
    const timeout = setTimeout(() => {
      const tick = (ts: number) => {
        if (!startTime.current) startTime.current = ts;
        const progress = Math.min((ts - startTime.current) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(eased * target);
        if (progress < 1) requestAnimationFrame(tick);
      };
      startTime.current = null;
      requestAnimationFrame(tick);
    }, delay);
    return () => clearTimeout(timeout);
  }, [target, duration, delay]);

  return value;
}

/* ─── Formatters ─── */

function fmtBig(v: number): string {
  if (v >= 100) return `$${Math.round(v)}`;
  return `$${v.toFixed(2)}`;
}

function fmtSmall(v: number): string {
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

/* ─── Small tile ─── */

function MiniTile({ label, value, color, dotColor }: { label: string; value: number; color: string; dotColor: string }) {
  const animated = useTickUp(value, 800, 200);
  return (
    <div className="card-elevated rounded-2xl p-3 border border-gray-800/50 flex flex-col items-center text-center">
      <span className="flex items-center gap-1.5 text-[11px] text-gray-500 mb-1">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: dotColor }} />
        {label}
      </span>
      <span className={`text-lg sm:text-xl font-bold tabular-nums ${color}`}>
        {fmtSmall(animated)}
      </span>
    </div>
  );
}

/* ─── Big hero tile ─── */

function HeroTile({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  const animated = useTickUp(value, 1200, 100);
  return (
    <div className="card-elevated rounded-2xl p-4 border border-gray-800/50 flex flex-col items-center text-center">
      <h2 className="text-sm font-semibold text-gray-400 mb-2">{label}</h2>
      <div className="mb-1">{icon}</div>
      <p className={`text-3xl sm:text-5xl font-bold tabular-nums ${color}`}>
        {fmtBig(animated)}
      </p>
    </div>
  );
}

/* ─── Main component ─── */

export default function SavingsTab({ daily, hourly, dateRange, setDateRange, sankeyFlows }: Props) {
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
    delta: 40,
    preventScrollOnSwipe: true,
  });

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    setOffset(0);
  };

  const handlePeriodChange = (range: DateRange) => {
    setDateRange(range);
  };

  const isDaily = mode === "daily" || dateRange.days === 1;

  /* ─── Compute all totals ─── */

  const totals = useMemo(() => {
    if (daily.length === 0) return {
      solarSavings: 0, batterySavings: 0, exportCredits: 0, totalSavings: 0,
      peakCost: 0, partPeakCost: 0, offPeakCost: 0, totalGridCost: 0,
    };

    let totalImportKwh = 0, totalCost = 0, solarSelfConsumedKwh = 0, exportCredit = 0;
    let peakCost = 0, partPeakCost = 0, offPeakCost = 0;

    for (const d of daily) {
      totalImportKwh += d.total_import_kwh;
      totalCost += d.total_cost;
      solarSelfConsumedKwh += d.solar_self_consumed_kwh;
      exportCredit += d.export_credit;
      peakCost += d.peak_cost;
      partPeakCost += d.part_peak_cost;
      offPeakCost += d.off_peak_cost;
    }

    const avgRate = totalImportKwh > 0 ? totalCost / totalImportKwh : 0.33;

    // Use real Sankey flow data when available, otherwise estimate from daily summaries
    let solarDirect: number;
    let batterySavings: number;
    if (sankeyFlows && (sankeyFlows.solar_to_home > 0 || sankeyFlows.battery_to_home > 0)) {
      solarDirect = sankeyFlows.solar_to_home * avgRate;
      batterySavings = sankeyFlows.battery_to_home * avgRate;
    } else {
      // Fallback: estimate from daily data using consumption split
      const totalSelfPowerSavings = solarSelfConsumedKwh * avgRate;
      solarDirect = totalSelfPowerSavings * 0.6;
      batterySavings = totalSelfPowerSavings * 0.4;
    }

    return {
      solarSavings: solarDirect,
      batterySavings,
      exportCredits: exportCredit,
      totalSavings: solarDirect + batterySavings + exportCredit,
      peakCost,
      partPeakCost,
      offPeakCost,
      totalGridCost: totalCost,
    };
  }, [daily, sankeyFlows]);

  /* ─── Average rate ─── */

  const avgRate = useMemo(() => {
    let totalImport = 0, totalCost = 0;
    for (const d of daily) { totalImport += d.total_import_kwh; totalCost += d.total_cost; }
    return totalImport > 0 ? totalCost / totalImport : 0.33;
  }, [daily]);

  /* ─── Chart data ─── */

  // Aggregate hourly data to 1-hour buckets (API may return 15-min or 5-min intervals)
  const hourlyBuckets = useMemo(() => {
    if (!isDaily || hourly.length === 0) return [];
    const bucketMap = new Map<number, HourlyBucket>();
    for (const h of hourly) {
      const dt = new Date(h.hour);
      const hourKey = dt.getHours();
      if (!bucketMap.has(hourKey)) {
        bucketMap.set(hourKey, { ...h });
      } else {
        const b = bucketMap.get(hourKey)!;
        b.solar_kwh += h.solar_kwh;
        b.grid_import_kwh += h.grid_import_kwh;
        b.grid_export_kwh += h.grid_export_kwh;
        b.battery_charge_kwh += h.battery_charge_kwh;
        b.battery_discharge_kwh += h.battery_discharge_kwh;
        b.home_kwh += h.home_kwh;
      }
    }
    // Generate all 24 hours
    const result: { hour: number; data: HourlyBucket | null }[] = [];
    for (let hr = 0; hr < 24; hr++) {
      result.push({ hour: hr, data: bucketMap.get(hr) || null });
    }
    return result;
  }, [isDaily, hourly]);

  const hourlySavingsData = useMemo(() => {
    if (hourlyBuckets.length === 0) return [];
    return hourlyBuckets.map(({ hour, data }) => {
      const label = hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`;
      if (!data) return { label, "Self-Power": 0, Powerwall: 0, "Export Credits": 0 };
      const solarDirectUse = Math.max(0, data.solar_kwh - data.grid_export_kwh - data.battery_charge_kwh);
      return {
        label,
        "Self-Power": parseFloat((solarDirectUse * avgRate).toFixed(1)),
        Powerwall: parseFloat((data.battery_discharge_kwh * avgRate).toFixed(1)),
        "Export Credits": parseFloat((data.grid_export_kwh * avgRate * 0.25).toFixed(1)),
      };
    });
  }, [hourlyBuckets, avgRate]);

  const hourlyCostData = useMemo(() => {
    if (hourlyBuckets.length === 0) return [];
    return hourlyBuckets.map(({ hour, data }) => {
      const label = hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`;
      if (!data) return { label, Cost: 0 };
      return {
        label,
        Cost: parseFloat((data.grid_import_kwh * avgRate).toFixed(1)),
      };
    });
  }, [hourlyBuckets, avgRate]);

  // Generate all days in range for full x-axis
  const allDaysInRange = useMemo(() => {
    const days: string[] = [];
    const start = new Date(dateRange.from + "T12:00:00");
    const end = new Date(dateRange.to + "T12:00:00");
    const d = new Date(start);
    while (d <= end) {
      days.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }
    return days;
  }, [dateRange]);

  const dailyMap = useMemo(() => {
    const map = new Map<string, DailySummary>();
    for (const d of daily) map.set(d.day, d);
    return map;
  }, [daily]);

  const savingsData = useMemo(() => {
    return allDaysInRange.map((day) => {
      const d = dailyMap.get(day);
      if (!d) return { label: formatDay(day), "Self-Power": 0, Powerwall: 0, "Export Credits": 0 };
      const rate = d.total_import_kwh > 0 ? d.total_cost / d.total_import_kwh : 0.33;
      const ts = d.solar_self_consumed_kwh * rate;
      return {
        label: formatDay(day),
        "Self-Power": parseFloat((ts * 0.6).toFixed(1)),
        Powerwall: parseFloat((ts * 0.4).toFixed(1)),
        "Export Credits": parseFloat(d.export_credit.toFixed(1)),
      };
    });
  }, [allDaysInRange, dailyMap]);

  const costData = useMemo(() => {
    return allDaysInRange.map((day) => {
      const d = dailyMap.get(day);
      if (!d) return { label: formatDay(day), Peak: 0, "Part-Peak": 0, "Off-Peak": 0 };
      return {
        label: formatDay(day),
        Peak: parseFloat(d.peak_cost.toFixed(1)),
        "Part-Peak": parseFloat(d.part_peak_cost.toFixed(1)),
        "Off-Peak": parseFloat(d.off_peak_cost.toFixed(1)),
      };
    });
  }, [allDaysInRange, dailyMap]);

  const [rateSchedule, setRateSchedule] = useState<RateScheduleEntry[]>([]);
  useEffect(() => {
    if (!isDaily) return;
    api.getRates(dateRange.from).then(data => setRateSchedule(data.schedule)).catch(() => {});
  }, [isDaily, dateRange.from]);

  const rateData = useMemo(() => {
    if (!isDaily || rateSchedule.length === 0) return [];
    return rateSchedule.map(entry => {
      const h = entry.hour;
      const label = h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
      const tier = entry.period === "peak" ? "Peak" : entry.period === "part_peak" ? "Part-Peak" : "Off-Peak";
      return { label, rate: entry.rate, tier };
    });
  }, [isDaily, rateSchedule]);

  const showMultiDayCharts = !isDaily && daily.length >= 1;
  const showHourlyCharts = isDaily && hourly.length > 0;

  const savingsMax = useMemo(() => {
    let max = 0;
    const check = (v: number) => { if (v > max) max = v; };
    if (showHourlyCharts) {
      for (const d of hourlySavingsData) check((d["Self-Power"] || 0) + (d.Powerwall || 0) + (d["Export Credits"] || 0));
    }
    if (showMultiDayCharts) {
      for (const d of savingsData) check((d["Self-Power"] || 0) + (d.Powerwall || 0) + (d["Export Credits"] || 0));
    }
    return Math.ceil(max * 1.1 * 10) / 10;
  }, [showHourlyCharts, showMultiDayCharts, hourlySavingsData, savingsData]);

  const costMax = useMemo(() => {
    let max = 0;
    const check = (v: number) => { if (v > max) max = v; };
    if (showHourlyCharts) {
      for (const d of hourlyCostData) check(d.Cost);
    }
    if (showMultiDayCharts) {
      for (const d of costData) check((d.Peak || 0) + (d["Part-Peak"] || 0) + (d["Off-Peak"] || 0));
    }
    return Math.ceil(max * 1.1 * 10) / 10;
  }, [showHourlyCharts, showMultiDayCharts, hourlyCostData, costData]);

  const tooltipStyle = {
    contentStyle: { backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 12 },
    labelStyle: { color: "#9ca3af" },
  };
  const chartHeight = 220;

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="sticky top-0 z-20 bg-gray-950 pb-2 -mx-3 px-3 sm:-mx-4 sm:px-4">
        <PeriodSelector value={dateRange} onChange={handlePeriodChange} onModeChange={handleModeChange} />
      </div>

      <div
        {...swipeHandlers}
        className={`transition-transform duration-300 ease-out ${
          swipeDir === "left" ? "-translate-x-2" : swipeDir === "right" ? "translate-x-2" : "translate-x-0"
        }`}
      >
        <div className="space-y-4">

          {/* ═══ SAVINGS SECTION ═══ */}
          <HeroTile
            label="Self-Power Savings"
            value={totals.totalSavings}
            icon={<Sun size={24} className="text-green-400" />}
            color="text-green-400"
          />

          <div className="grid grid-cols-3 gap-2">
            <MiniTile label="Solar" value={totals.solarSavings} color="text-green-400" dotColor="#166534" />
            <MiniTile label="Powerwall" value={totals.batterySavings} color="text-green-400" dotColor="#4ade80" />
            <MiniTile label="Export Credits" value={totals.exportCredits} color="text-gray-400" dotColor="#6b7280" />
          </div>

          {/* Savings chart */}
          {(showHourlyCharts || showMultiDayCharts) && (
            <div className="card-chart rounded-2xl p-3 sm:p-4 border border-gray-800/50">
              <h2 className="text-sm font-semibold text-gray-400 mb-2">Savings Breakdown</h2>
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart data={showHourlyCharts ? hourlySavingsData : savingsData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="label" tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={{ stroke: "#374151" }} tickLine={false} />
                  <YAxis domain={[0, savingsMax]} tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v.toFixed(1)}`} />
                  <Tooltip {...tooltipStyle} formatter={(value: number) => fmtSmall(value)} />
                  <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                  <Bar dataKey="Self-Power" stackId="s" fill="#166534" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Powerwall" stackId="s" fill="#4ade80" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Export Credits" stackId="s" fill="#6b7280" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ═══ GRID COSTS SECTION ═══ */}
          <HeroTile
            label="Grid Costs"
            value={totals.totalGridCost}
            icon={<Zap size={24} className="text-red-400" />}
            color="text-red-400"
          />

          <div className="grid grid-cols-3 gap-2">
            <MiniTile label="Peak" value={totals.peakCost} color="text-red-400" dotColor="#ef4444" />
            <MiniTile label="Part-Peak" value={totals.partPeakCost} color="text-red-300" dotColor="#f87171" />
            <MiniTile label="Off-Peak" value={totals.offPeakCost} color="text-red-200" dotColor="#fca5a5" />
          </div>

          {/* Cost chart */}
          {(showHourlyCharts || showMultiDayCharts) && (
            <div className="card-chart rounded-2xl p-3 sm:p-4 border border-gray-800/50">
              <h2 className="text-sm font-semibold text-gray-400 mb-2">Cost Breakdown</h2>
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart data={showHourlyCharts ? hourlyCostData : costData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="label" tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={{ stroke: "#374151" }} tickLine={false} />
                  <YAxis domain={[0, costMax || 1]} tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v.toFixed(1)}`} />
                  <Tooltip {...tooltipStyle} formatter={(value: number) => fmtSmall(value)} />
                  {showHourlyCharts ? (
                    <Bar dataKey="Cost" fill="#ef4444" radius={[2, 2, 0, 0]} />
                  ) : (
                    <>
                      <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconSize={8} />
                      <Bar dataKey="Peak" stackId="c" fill="#ef4444" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="Part-Peak" stackId="c" fill="#f87171" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="Off-Peak" stackId="c" fill="#fca5a5" radius={[2, 2, 0, 0]} />
                    </>
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Rate schedule (daily only) */}
          {showHourlyCharts && (
            <div className="card-chart rounded-2xl p-3 sm:p-4 border border-gray-800/50">
              <h2 className="text-sm font-semibold text-gray-400 mb-2">Grid Rate Schedule</h2>
              <ResponsiveContainer width="100%" height={chartHeight}>
                <BarChart data={rateData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="label" tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={{ stroke: "#374151" }} tickLine={false} />
                  <YAxis tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v.toFixed(2)}`} domain={[0, 0.5]} />
                  <Tooltip
                    {...tooltipStyle}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(value: any, _name: any, props: any) =>
                      [`$${Number(value).toFixed(2)}/kWh`, props?.payload?.tier || "Rate"]
                    }
                  />
                  <Bar
                    dataKey="rate"
                    radius={[2, 2, 0, 0]}
                    name="Rate"
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    shape={(props: any) => {
                      const tier = props.payload?.tier;
                      const fill = tier === "Peak" ? "#ef4444" : tier === "Part-Peak" ? "#f59e0b" : "#3b82f6";
                      return <rect {...props} fill={fill} />;
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 mt-1 text-[10px]">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />Peak</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />Part-Peak</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" />Off-Peak</span>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
