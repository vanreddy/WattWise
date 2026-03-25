"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useSwipeable } from "react-swipeable";
import type { DailySummary, HourlyBucket, SankeyFlows, IntervalPoint, SummaryResponse } from "@/lib/api";
import { api } from "@/lib/api";
import type { WeatherData } from "@/hooks/useWeather";
import type { DateRange } from "@/hooks/useDashboardData";
import PeriodSelector, { computeRange, type Mode } from "@/components/PeriodSelector";
import SelfPoweredRing from "@/components/SelfPoweredRing";
import SankeyChart from "@/components/SankeyChart";
import HourlyChart from "@/components/HourlyChart";
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import { Sun, Cloud, CloudRain, CloudSnow, CloudLightning, CloudDrizzle, Wind } from "lucide-react";

/* ─── Now mode: weather only ─── */

function WeatherIcon({ condition, size = 28 }: { condition: string; size?: number }) {
  if (condition === "thunderstorm") return <CloudLightning size={size} className="text-yellow-400" />;
  if (condition === "rain") return <CloudRain size={size} className="text-blue-400" />;
  if (condition === "snow") return <CloudSnow size={size} className="text-blue-200" />;
  if (condition === "fog") return <Wind size={size} className="text-gray-400" />;
  if (condition === "cloudy") return <Cloud size={size} className="text-gray-400" />;
  if (condition === "partly_cloudy") return <Cloud size={size} className="text-gray-300" />;
  return <Sun size={size} className="text-yellow-400" />;
}

function NowContent({ weather, lastUpdated, summary }: { weather: WeatherData | null; lastUpdated: Date | null; summary: SummaryResponse | null }) {
  const current = summary?.current;
  const [liveFlows, setLiveFlows] = useState<SankeyFlows | null>(null);

  // Fetch live Sankey flows from backend (single source of truth)
  useEffect(() => {
    api.getSankeyLive().then(res => setLiveFlows(res.flows)).catch(() => {});
  }, [current?.ts]);

  // Self-powered % from live flows
  const solarToHome = liveFlows?.solar_to_home ?? 0;
  const batToHome = liveFlows?.battery_to_home ?? 0;
  const gridToHome = liveFlows?.grid_to_home ?? 0;
  const totalToHome = solarToHome + batToHome + gridToHome;
  const selfPoweredPct = totalToHome > 0 ? Math.round(((totalToHome - gridToHome) / totalToHome) * 100) : 0;
  const solarPct = totalToHome > 0 ? Math.round((solarToHome / totalToHome) * 100) : 0;
  const batteryPct = totalToHome > 0 ? Math.round((batToHome / totalToHome) * 100) : 0;

  // Battery status
  const batteryChargePct = current?.battery_pct ?? 0;
  const batteryW = current?.battery_w ?? 0;
  const isCharging = batteryW < -50;
  const isDischarging = batteryW > 50;
  const batteryStatus = isCharging ? "Charging" : isDischarging ? "Discharging" : "Idle";
  const batteryStatusColor = isCharging ? "text-green-400" : isDischarging ? "text-yellow-400" : "text-gray-500";
  const batteryIcon = isCharging ? "⚡" : isDischarging ? "▼" : "—";

  // Timestamp from the actual data point
  const dataTs = current?.ts ? new Date(current.ts) : null;

  return (
    <div className="space-y-4">
      {/* Weather + data timestamp */}
      <div className="flex items-center justify-between px-1">
        {weather ? (
          <div className="flex items-center gap-2">
            <WeatherIcon condition={weather.condition} size={20} />
            <span className="text-sm text-gray-400">{Math.round(weather.temperature)}°F</span>
            <span className="text-xs text-gray-600 capitalize">{weather.description}</span>
          </div>
        ) : <div />}
        {dataTs && (
          <p className="text-xs text-gray-600">
            Live · {dataTs.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </p>
        )}
      </div>

      {/* Self-Powering Ring */}
      <SelfPoweredRing
        selfPoweredPct={Math.max(0, Math.min(100, selfPoweredPct))}
        solarPct={solarPct}
        batteryPct={batteryPct}
        label="Self-Powering"
      />

      {/* Powerwall Battery Tile — compact inline */}
      <div className="bg-gray-900/60 border border-gray-800/50 rounded-2xl px-4 py-3 flex items-center gap-4">
        <div className="shrink-0">
          <p className="text-xs font-semibold text-gray-400">Powerwall</p>
        </div>
        <div className="flex-1 min-w-0">
          <div className="w-full bg-gray-800 rounded-full h-2.5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${batteryChargePct}%`,
                background: batteryChargePct > 20 ? "#34d399" : "#f87171",
              }}
            />
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <span className="text-lg font-bold text-green-400">{Math.round(batteryChargePct)}%</span>
          <span className={`text-[10px] ${batteryStatusColor} flex items-center gap-0.5`}>
            <span>{batteryIcon}</span> {batteryStatus}
            {(isCharging || isDischarging) && (
              <span className="text-gray-500 ml-0.5">
                {(Math.abs(batteryW) / 1000).toFixed(1)} kW
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Live Sankey */}
      {liveFlows && (
        <SankeyChart
          hourlyData={[]}
          dailyData={[]}
          days={0}
          sankeyFlows={liveFlows}
          animated
          liveUnits
          hideBreakdown
        />
      )}
    </div>
  );
}

interface Props {
  daily: DailySummary[];
  hourly: HourlyBucket[];
  intervalData: IntervalPoint[];
  sankeyFlows: SankeyFlows | null;
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  backfillActive: boolean;
  summary: SummaryResponse | null;
  lastUpdated: Date | null;
  error: string | null;
  weather: WeatherData | null;
}

/* ─── Historical mode content ─── */

function BatteryPctChart({ intervalData, isToday }: { intervalData: IntervalPoint[]; isToday?: boolean }) {
  if (!intervalData.length) return null;

  // Build 96-slot (15-min) grid matching HourlyChart structure
  const SLOTS = 96;
  const now = new Date();
  const nowSlot = isToday ? now.getHours() * 4 + Math.floor(now.getMinutes() / 15) : SLOTS;

  // Index interval data by 15-min slot
  const slotMap = new Map<number, number>();
  for (const d of intervalData) {
    const dt = new Date(d.ts);
    const idx = dt.getHours() * 4 + Math.floor(dt.getMinutes() / 15);
    if (!slotMap.has(idx)) slotMap.set(idx, d.battery_pct);
  }

  const chartData = Array.from({ length: SLOTS }, (_, i) => {
    const h = Math.floor(i / 4);
    const m = (i % 4) * 15;
    const h12 = h % 12 || 12;
    const ampm = h < 12 ? "AM" : "PM";
    const label = m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, "0")}`;

    if (isToday && i > nowSlot) {
      return { label, pct: null };
    }
    const pct = slotMap.get(i);
    return { label, pct: pct ?? null };
  });

  return (
    <div className="bg-gray-900/60 border border-gray-800/50 rounded-2xl p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Powerwall %</h3>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={chartData} margin={{ top: 10, right: 5, bottom: 0, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="#6b7280"
            fontSize={10}
            interval={11}
            tick={{ dy: 4 }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            stroke="#6b7280"
            fontSize={10}
            tickFormatter={(v: number) => `${v}%`}
            width={35}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "#9ca3af" }}
            formatter={(value: number) => [`${value.toFixed(0)}%`, "Powerwall"]}
          />
          <defs>
            <linearGradient id="battGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="pct" stroke="#34d399" strokeWidth={2} fill="url(#battGrad)" fillOpacity={0.3} connectNulls={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function SelfPoweredByDayChart({ daily, intervalData, dateRange }: { daily: DailySummary[]; intervalData: IntervalPoint[]; dateRange: DateRange }) {
  if (daily.length < 2 && !dateRange) return null;

  // Generate all days in the dateRange
  const allDays: string[] = [];
  {
    const start = new Date(dateRange.from + "T12:00:00");
    const end = new Date(dateRange.to + "T12:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      allDays.push(d.toISOString().slice(0, 10));
    }
  }

  if (allDays.length < 2) return null;

  // Index existing daily data by day
  const dailyMap = new Map(daily.map(d => [d.day, d]));

  const maxH = 240;
  const padding = { left: 40, right: 16, top: 16, bottom: 50 };
  const w = 600;
  const chartW = w - padding.left - padding.right;
  const chartH = maxH - padding.top - padding.bottom;
  const barW = Math.min(40, chartW / allDays.length * 0.7);
  const gap = (chartW - barW * allDays.length) / (allDays.length + 1);

  // Compute per-day Sankey flows from interval data for accurate solar/battery split
  const IH = 5 / 60 / 1000; // 5-min interval → kWh
  const dayFlows = new Map<string, { solarToHome: number; battToHome: number; gridToHome: number }>();
  for (const pt of intervalData) {
    const dayKey = pt.ts.slice(0, 10); // "YYYY-MM-DD"
    if (!dayFlows.has(dayKey)) dayFlows.set(dayKey, { solarToHome: 0, battToHome: 0, gridToHome: 0 });
    const f = dayFlows.get(dayKey)!;
    const solar = Math.max(0, pt.solar_w) * IH;
    const home = Math.max(0, pt.home_w) * IH;
    const gridImp = Math.max(0, pt.grid_w) * IH;
    const batDis = Math.max(0, pt.battery_w) * IH;
    const s2h = Math.min(solar, home);
    f.solarToHome += s2h;
    const remainHome = Math.max(0, home - s2h);
    const b2h = Math.min(batDis, remainHome);
    f.battToHome += b2h;
    f.gridToHome += Math.max(0, remainHome - b2h);
  }

  const bars = allDays.map((day, i) => {
    const flows = dayFlows.get(day);
    let solarPct = 0, battPct = 0, totalPct = 0;
    if (flows) {
      const total = flows.solarToHome + flows.battToHome + flows.gridToHome;
      if (total > 0) {
        solarPct = (flows.solarToHome / total) * 100;
        battPct = (flows.battToHome / total) * 100;
        totalPct = solarPct + battPct;
      }
    }
    const x = padding.left + gap + i * (barW + gap);
    const dt = new Date(day + "T12:00:00");
    const dayLabel = dt.toLocaleDateString("en-US", { weekday: "short" });
    const dateLabel = dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return { x, solarPct, battPct, totalPct, dayLabel, dateLabel, day };
  });

  return (
    <div className="bg-gray-900/60 border border-gray-800/50 rounded-2xl p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-1">Self-Powered by Day</h3>
      <div className="flex gap-3 text-[10px] text-gray-500 mb-2">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-yellow-500 inline-block" /> Solar</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block" /> Powerwall</span>
      </div>
      <svg viewBox={`0 0 ${w} ${maxH}`} className="w-full" style={{ height: 240 }}>
        {/* Y grid */}
        {[0, 25, 50, 75, 100].map(pct => {
          const y = padding.top + (1 - pct / 100) * chartH;
          return (
            <g key={pct}>
              <line x1={padding.left} x2={w - padding.right} y1={y} y2={y} stroke="#374151" strokeWidth={0.5} />
              <text x={padding.left - 6} y={y + 3} textAnchor="end" className="fill-gray-600" fontSize={9}>{pct}%</text>
            </g>
          );
        })}
        {/* Bars */}
        {bars.map((b, i) => {
          const solarH = (b.solarPct / 100) * chartH;
          const battH = (b.battPct / 100) * chartH;
          const solarY = padding.top + chartH - solarH;
          const battY = solarY - battH;
          const topY = battH > 0 ? battY : solarY;
          return (
            <g key={i}>
              <rect x={b.x} y={solarY} width={barW} height={solarH} rx={3} fill="#eab308" />
              <rect x={b.x} y={battY} width={barW} height={battH} rx={3} fill="#22c55e" />
              <text x={b.x + barW / 2} y={topY - 4} textAnchor="middle" className="fill-gray-300" fontSize={9} fontWeight="600">
                {Math.round(b.totalPct)}%
              </text>
              <text x={b.x + barW / 2} y={maxH - 18} textAnchor="middle" className="fill-gray-500" fontSize={9}>{b.dayLabel}</text>
              <text x={b.x + barW / 2} y={maxH - 7} textAnchor="middle" className="fill-gray-600" fontSize={7}>{b.dateLabel}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function SelfPoweredByMonthChart({ daily, intervalData }: { daily: DailySummary[]; intervalData: IntervalPoint[] }) {
  if (daily.length < 28) return null; // need at least ~1 month

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const maxH = 220;
  const padding = { left: 40, right: 16, top: 16, bottom: 40 };
  const w = 600;
  const chartH = maxH - padding.top - padding.bottom;

  // Compute per-day flows from intervals
  const IH = 5 / 60 / 1000;
  const dayFlows = new Map<string, { solarToHome: number; battToHome: number; gridToHome: number }>();
  for (const pt of intervalData) {
    const dayKey = pt.ts.slice(0, 10);
    if (!dayFlows.has(dayKey)) dayFlows.set(dayKey, { solarToHome: 0, battToHome: 0, gridToHome: 0 });
    const f = dayFlows.get(dayKey)!;
    const solar = Math.max(0, pt.solar_w) * IH;
    const home = Math.max(0, pt.home_w) * IH;
    const batDis = Math.max(0, pt.battery_w) * IH;
    const s2h = Math.min(solar, home);
    f.solarToHome += s2h;
    const remainHome = Math.max(0, home - s2h);
    const b2h = Math.min(batDis, remainHome);
    f.battToHome += b2h;
    f.gridToHome += Math.max(0, remainHome - b2h);
  }

  // Aggregate by month
  const monthData = new Map<number, { solarToHome: number; battToHome: number; gridToHome: number }>();
  for (const [dayKey, flows] of dayFlows) {
    const m = new Date(dayKey + "T12:00:00").getMonth();
    if (!monthData.has(m)) monthData.set(m, { solarToHome: 0, battToHome: 0, gridToHome: 0 });
    const md = monthData.get(m)!;
    md.solarToHome += flows.solarToHome;
    md.battToHome += flows.battToHome;
    md.gridToHome += flows.gridToHome;
  }

  // Always show all 12 months
  const chartW = w - padding.left - padding.right;
  const barW = Math.min(36, chartW / 12 * 0.7);
  const gap = (chartW - barW * 12) / 13;

  const now = new Date();
  const currentMonth = now.getMonth();

  const bars = months.map((label, m) => {
    const d = monthData.get(m);
    const total = d ? d.solarToHome + d.battToHome + d.gridToHome : 0;
    const solarPct = total > 0 ? (d!.solarToHome / total) * 100 : 0;
    const battPct = total > 0 ? (d!.battToHome / total) * 100 : 0;
    const totalPct = solarPct + battPct;
    const x = padding.left + gap + m * (barW + gap);
    const isFuture = m > currentMonth;
    return { x, solarPct, battPct, totalPct, label, isFuture };
  });

  return (
    <div className="bg-gray-900/60 border border-gray-800/50 rounded-2xl p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-1">Self-Powered by Month</h3>
      <div className="flex gap-3 text-[10px] text-gray-500 mb-2">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-yellow-500 inline-block" /> Solar</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block" /> Powerwall</span>
      </div>
      <svg viewBox={`0 0 ${w} ${maxH}`} className="w-full" style={{ height: 180 }}>
        {[0, 25, 50, 75, 100].map(pct => {
          const y = padding.top + (1 - pct / 100) * chartH;
          return (
            <g key={pct}>
              <line x1={padding.left} x2={w - padding.right} y1={y} y2={y} stroke="#374151" strokeWidth={0.5} />
              <text x={padding.left - 6} y={y + 3} textAnchor="end" className="fill-gray-600" fontSize={9}>{pct}%</text>
            </g>
          );
        })}
        {bars.map((b, i) => {
          const solarH = (b.solarPct / 100) * chartH;
          const battH = (b.battPct / 100) * chartH;
          const solarY = padding.top + chartH - solarH;
          const battY = solarY - battH;
          const topY = battH > 0 ? battY : solarY;
          return (
            <g key={i}>
              {!b.isFuture && solarH > 0 && <rect x={b.x} y={solarY} width={barW} height={solarH} rx={3} fill="#eab308" />}
              {!b.isFuture && battH > 0 && <rect x={b.x} y={battY} width={barW} height={battH} rx={3} fill="#22c55e" />}
              {!b.isFuture && b.totalPct > 0 && (
                <text x={b.x + barW / 2} y={topY - 4} textAnchor="middle" className="fill-gray-300" fontSize={9} fontWeight="600">
                  {Math.round(b.totalPct)}%
                </text>
              )}
              <text x={b.x + barW / 2} y={maxH - 10} textAnchor="middle" className={b.isFuture ? "fill-gray-700" : "fill-gray-500"} fontSize={9}>{b.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function EnergyFlowBarChart({ daily, intervalData, groupBy, dateRange }: { daily: DailySummary[]; intervalData: IntervalPoint[]; groupBy: "day" | "month"; dateRange: DateRange }) {
  const chartData = useMemo(() => {
    // Compute accurate per-bucket flows from interval data
    const IH = 5 / 60 / 1000; // 5-min interval watts → kWh
    const bucketKey = (ts: string) => groupBy === "month"
      ? ts.slice(0, 7) // "YYYY-MM"
      : ts.slice(0, 10); // "YYYY-MM-DD"

    const buckets = new Map<string, {
      solar: number; gridImport: number; gridExport: number;
      battDischarge: number; battCharge: number;
      home: number; ev: number;
    }>();

    for (const pt of intervalData) {
      const key = bucketKey(pt.ts);
      if (!buckets.has(key)) buckets.set(key, { solar: 0, gridImport: 0, gridExport: 0, battDischarge: 0, battCharge: 0, home: 0, ev: 0 });
      const b = buckets.get(key)!;
      b.solar += Math.max(0, pt.solar_w) * IH;
      b.gridImport += Math.max(0, pt.grid_w) * IH;
      b.gridExport += Math.max(0, -pt.grid_w) * IH;
      b.battDischarge += Math.max(0, pt.battery_w) * IH;
      b.battCharge += Math.max(0, -pt.battery_w) * IH;
      b.home += Math.max(0, pt.home_w) * IH;
      b.ev += Math.max(0, pt.vehicle_w || 0) * IH;
    }

    // If no interval data, fall back to daily summaries
    if (buckets.size === 0) {
      for (const d of daily) {
        const key = groupBy === "month" ? d.day.slice(0, 7) : d.day;
        buckets.set(key, {
          solar: d.solar_generated_kwh,
          gridImport: d.total_import_kwh,
          gridExport: d.total_export_kwh,
          battDischarge: 0, battCharge: 0,
          home: Math.max(0, d.solar_generated_kwh - d.total_export_kwh + d.total_import_kwh - d.ev_kwh),
          ev: d.ev_kwh,
        });
      }
    }

    // Generate full list of keys from dateRange
    const allKeys: string[] = [];
    if (groupBy === "day") {
      const start = new Date(dateRange.from + "T12:00:00");
      const end = new Date(dateRange.to + "T12:00:00");
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        allKeys.push(d.toISOString().slice(0, 10));
      }
    } else {
      // month groupBy: generate all months in range
      const startDate = new Date(dateRange.from + "T12:00:00");
      const endDate = new Date(dateRange.to + "T12:00:00");
      let cur = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      const endMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
      while (cur <= endMonth) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, "0");
        allKeys.push(`${y}-${m}`);
        cur.setMonth(cur.getMonth() + 1);
      }
    }

    const emptyBucket = { solar: 0, gridImport: 0, gridExport: 0, battDischarge: 0, battCharge: 0, home: 0, ev: 0 };
    const today = new Date();
    const todayKey = groupBy === "month"
      ? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`
      : today.toISOString().slice(0, 10);

    return allKeys.map(key => {
      const isFuture = key > todayKey && !buckets.has(key);
      const b = buckets.get(key) || emptyBucket;
      const srcTotal = b.solar + b.gridImport + b.battDischarge;
      const sinkTotal = b.home + b.ev + b.gridExport + b.battCharge;
      const r = (v: number) => Math.round(v * 10) / 10;

      let label: string;
      if (groupBy === "month") {
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        label = months[parseInt(key.slice(5, 7), 10) - 1] || key;
      } else {
        const dt = new Date(key + "T12:00:00");
        const dayName = dt.toLocaleDateString("en-US", { weekday: "short" });
        const dateName = dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        label = allKeys.length <= 10 ? `${dayName} ${dateName}` : dateName;
      }

      return {
        label,
        // Sources (positive) — null for future so Recharts leaves gaps
        solar: isFuture ? null : r(b.solar),
        gridImport: isFuture ? null : r(b.gridImport),
        batteryDischarge: isFuture ? null : r(b.battDischarge),
        // Sinks (negative)
        home: isFuture ? null : -r(b.home),
        ev: isFuture ? null : -r(b.ev),
        gridExport: isFuture ? null : -r(b.gridExport),
        batteryCharge: isFuture ? null : -r(b.battCharge),
        srcTotal: isFuture ? null : r(srcTotal),
        sinkTotal: isFuture ? null : r(sinkTotal),
      };
    });
  }, [daily, intervalData, groupBy, dateRange]);

  if (chartData.length === 0) return null;

  const n = (v: number | null) => v ?? 0;
  const maxSource = Math.max(...chartData.map(d => Math.abs(n(d.solar)) + Math.abs(n(d.gridImport)) + Math.abs(n(d.batteryDischarge))));
  const maxSink = Math.max(...chartData.map(d => Math.abs(n(d.home)) + Math.abs(n(d.ev)) + Math.abs(n(d.gridExport)) + Math.abs(n(d.batteryCharge))));
  const yMax = Math.ceil(Math.max(maxSource, maxSink) * 1.15);

  // Custom tooltip
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload) return null;
    const srcItems = payload.filter((p: any) => p.value > 0);
    const sinkItems = payload.filter((p: any) => p.value < 0);
    const srcTotal = srcItems.reduce((s: number, p: any) => s + p.value, 0);
    const sinkTotal = sinkItems.reduce((s: number, p: any) => s + Math.abs(p.value), 0);
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-2 text-xs">
        <p className="text-gray-400 mb-1">{label}</p>
        {srcItems.length > 0 && <p className="text-gray-300 font-medium">Sources: {srcTotal.toFixed(1)} kWh</p>}
        {srcItems.map((p: any) => <p key={p.name} style={{ color: p.color }}>{p.name}: {p.value.toFixed(1)} kWh</p>)}
        {sinkItems.length > 0 && <p className="text-gray-300 font-medium mt-1">Sinks: {sinkTotal.toFixed(1)} kWh</p>}
        {sinkItems.map((p: any) => <p key={p.name} style={{ color: p.color }}>{p.name}: {Math.abs(p.value).toFixed(1)} kWh</p>)}
      </div>
    );
  };

  return (
    <div className="bg-gray-900/60 border border-gray-800/50 rounded-2xl p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-1">
        Energy Flow by {groupBy === "month" ? "Month" : "Day"}
      </h3>
      <div className="flex justify-center gap-3 text-[10px] text-gray-500 mb-2">
        <span className="text-gray-400 font-medium">Sources ↑</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: "#facc15" }} /> Solar</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: "#f87171" }} /> Grid</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: "#34d399" }} /> Powerwall</span>
      </div>
      <ResponsiveContainer width="100%" height={350}>
        <AreaChart data={chartData} margin={{ top: 10, right: 40, bottom: 0, left: 40 }} stackOffset="sign">
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
          <XAxis dataKey="label" stroke="#6b7280" fontSize={9} tickLine={false} tick={{ dy: 4 }} interval={0} padding={{ left: 20, right: 20 }} />
          <YAxis domain={[-yMax, yMax]} stroke="#6b7280" fontSize={9} tickLine={false} axisLine={false}
            tickFormatter={(v: number) => `${Math.abs(v)}`} />
          <ReferenceLine y={0} stroke="#6b7280" strokeWidth={1.5} />
          <Tooltip content={<CustomTooltip />} />
          {/* Sources (negative = above zero line via sign offset) */}
          <Area type="monotone" dataKey="solar" stackId="src" stroke="#facc15" fill="#facc15" fillOpacity={0.15} strokeWidth={2} name="Solar" />
          <Area type="monotone" dataKey="gridImport" stackId="src" stroke="#f87171" fill="#f87171" fillOpacity={0.15} strokeWidth={2} name="Grid" />
          <Area type="monotone" dataKey="batteryDischarge" stackId="src" stroke="#34d399" fill="#34d399" fillOpacity={0.15} strokeWidth={2} name="Powerwall" />
          {/* Sinks (positive = below zero line) */}
          <Area type="monotone" dataKey="home" stackId="sink" stroke="#60a5fa" fill="#60a5fa" fillOpacity={0.15} strokeWidth={2} name="Home" />
          <Area type="monotone" dataKey="ev" stackId="sink" stroke="#a78bfa" fill="#a78bfa" fillOpacity={0.15} strokeWidth={2} name="EV" />
          <Area type="monotone" dataKey="gridExport" stackId="sink" stroke="#f87171" fill="#f87171" fillOpacity={0.15} strokeWidth={2} name="Grid Export" />
          <Area type="monotone" dataKey="batteryCharge" stackId="sink" stroke="#34d399" fill="#34d399" fillOpacity={0.15} strokeWidth={2} name="Powerwall Charge" />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex justify-center gap-3 text-[10px] text-gray-500 mt-2">
        <span className="text-gray-400 font-medium">Sinks ↓</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: "#60a5fa" }} /> Home</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: "#a78bfa" }} /> EV</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: "#f87171" }} /> Grid</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ background: "#34d399" }} /> Powerwall</span>
      </div>
    </div>
  );
}

function HistoricalContent({ daily, hourly, intervalData, sankeyFlows, dateRange, swipeDir, mode }: {
  daily: DailySummary[];
  hourly: HourlyBucket[];
  intervalData: IntervalPoint[];
  sankeyFlows: SankeyFlows | null;
  dateRange: DateRange;
  swipeDir: "left" | "right" | null;
  mode: Mode;
}) {
  // Compute self-powered % with solar/battery breakout
  let gridImport = 0;
  let totalConsumption = 0;
  let solarToHome = 0;
  let batteryToHome = 0;
  if (sankeyFlows) {
    gridImport = sankeyFlows.grid_to_home + sankeyFlows.grid_to_battery;
    solarToHome = sankeyFlows.solar_to_home;
    batteryToHome = sankeyFlows.battery_to_home;
    totalConsumption = solarToHome + batteryToHome + sankeyFlows.grid_to_home;
  } else if (daily.length > 0) {
    gridImport = daily.reduce((s, d) => s + d.total_import_kwh, 0);
    const solar = daily.reduce((s, d) => s + d.solar_generated_kwh, 0);
    const exp = daily.reduce((s, d) => s + d.total_export_kwh, 0);
    totalConsumption = gridImport + solar - exp;
    solarToHome = daily.reduce((s, d) => s + d.solar_self_consumed_kwh, 0);
    batteryToHome = Math.max(0, totalConsumption - solarToHome - gridImport);
  }
  const selfPoweredPct = totalConsumption > 0
    ? Math.max(0, (1 - gridImport / totalConsumption) * 100)
    : 0;
  const solarPct = totalConsumption > 0 ? (solarToHome / totalConsumption) * 100 : 0;
  const batteryPctVal = totalConsumption > 0 ? (batteryToHome / totalConsumption) * 100 : 0;

  return (
    <div
      className={`transition-transform duration-300 ease-out ${
        swipeDir === "left"
          ? "-translate-x-2"
          : swipeDir === "right"
            ? "translate-x-2"
            : "translate-x-0"
      }`}
    >
      <div className="space-y-4">
        <SelfPoweredRing selfPoweredPct={selfPoweredPct} solarPct={solarPct} batteryPct={batteryPctVal} />

        {/* Weekly/Monthly: Self-Powered % by day */}
        {(mode === "weekly" || mode === "monthly") && <SelfPoweredByDayChart daily={daily} intervalData={intervalData} dateRange={dateRange} />}

        {/* Yearly: Self-Powered % by month */}
        {mode === "yearly" && <SelfPoweredByMonthChart daily={daily} intervalData={intervalData} />}

        <SankeyChart
          hourlyData={hourly}
          dailyData={daily}
          days={dateRange.days}
          sankeyFlows={sankeyFlows}
          animated
        />

        {/* Weekly/Monthly: Energy Flow by Day */}
        {(mode === "weekly" || mode === "monthly") && <EnergyFlowBarChart daily={daily} intervalData={intervalData} groupBy="day" dateRange={dateRange} />}

        {/* Yearly: Energy Flow by Month */}
        {mode === "yearly" && <EnergyFlowBarChart daily={daily} intervalData={intervalData} groupBy="month" dateRange={dateRange} />}

        {/* Daily only: Hourly chart + Battery % */}
        {mode === "daily" && <HourlyChart data={hourly} days={dateRange.days} intervalData={intervalData} />}
        {mode === "daily" && <BatteryPctChart intervalData={intervalData} isToday={dateRange.days === 1 && dateRange.from === new Date().toISOString().slice(0, 10)} />}
      </div>
    </div>
  );
}

/* ─── Main FlowTab ─── */

export default function FlowTab({
  daily,
  hourly,
  intervalData,
  sankeyFlows,
  dateRange,
  setDateRange,
  backfillActive,
  summary,
  lastUpdated,
  error,
  weather,
}: Props) {
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

  return (
    <div className="space-y-4">
      {/* Period selector — sticky */}
      <div className="sticky top-0 z-20 bg-gray-950 pb-2 -mx-3 px-3 sm:-mx-4 sm:px-4">
        <PeriodSelector
          value={dateRange}
          onChange={handlePeriodChange}
          onModeChange={handleModeChange}
          modes={["now", "daily", "weekly", "monthly", "yearly"]}
          defaultMode="daily"
        />
      </div>

      {/* Content */}
      {mode === "now" ? (
        <NowContent weather={weather} lastUpdated={lastUpdated} summary={summary} />
      ) : (
        <div {...swipeHandlers}>
          <HistoricalContent
            daily={daily}
            hourly={hourly}
            intervalData={intervalData}
            sankeyFlows={sankeyFlows}
            dateRange={dateRange}
            swipeDir={swipeDir}
            mode={mode}
          />
        </div>
      )}
    </div>
  );
}
