"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
import { Activity } from "lucide-react";
import type { HourlyBucket, IntervalPoint } from "@/lib/api";

function formatW(value: number) {
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}kW`;
  return `${Math.round(value)}W`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const sources = payload.filter((p: any) => p.value > 0);
  const sinks = payload.filter((p: any) => p.value < 0);
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs">
      <div className="text-gray-400 mb-2">{label}</div>
      {sources.length > 0 && (
        <div className="mb-1">
          <span className="text-gray-500">Sources</span>
          {sources.map((p: any) => (
            <div key={p.dataKey} className="flex justify-between gap-4">
              <span style={{ color: p.stroke }}>{p.name}</span>
              <span className="text-gray-300">{formatW(p.value)}</span>
            </div>
          ))}
        </div>
      )}
      {sinks.length > 0 && (
        <div>
          <span className="text-gray-500">Sinks</span>
          {sinks.map((p: any) => (
            <div key={p.dataKey} className="flex justify-between gap-4">
              <span style={{ color: p.stroke }}>{p.name}</span>
              <span className="text-gray-300">{formatW(Math.abs(p.value))}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const HOUR_LABELS = [
  "12 AM", "1 AM", "2 AM", "3 AM", "4 AM", "5 AM",
  "6 AM", "7 AM", "8 AM", "9 AM", "10 AM", "11 AM",
  "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM",
  "6 PM", "7 PM", "8 PM", "9 PM", "10 PM", "11 PM",
];

const EMPTY_POINT = {
  solar: 0, grid_import: 0, battery_discharge: 0,
  home: 0, ev: 0, grid_export: 0, battery_charge: 0,
};

type ChartPoint = {
  label: string;
  solar: number | null;
  grid_import: number | null;
  battery_discharge: number | null;
  home: number | null;
  ev: number | null;
  grid_export: number | null;
  battery_charge: number | null;
};

function formatTimeLabel(ts: string): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

interface Props {
  data: HourlyBucket[];
  days?: number;
  intervalData?: IntervalPoint[];
}

export default function HourlyChart({ data, days = 1, intervalData }: Props) {
  const useIntervals = !!(intervalData && intervalData.length > 0);

  const totalEnergy = useMemo(() => {
    // Use backend-computed _kwh fields for accuracy (same source as Sankey)
    if (data.length > 0 && data[0].solar_kwh !== undefined) {
      let total = 0;
      for (const d of data) {
        total += (d.solar_kwh || 0) + (d.grid_import_kwh || 0) + (d.battery_discharge_kwh || 0);
      }
      return total;
    }
    // Fallback: compute from interval data
    if (useIntervals) {
      let total = 0;
      for (const d of intervalData!) {
        total += (Math.max(0, d.solar_w) + Math.max(0, d.grid_w) + Math.max(0, d.battery_w)) / 1000;
      }
      return total * (5 / 60);
    }
    let total = 0;
    for (const d of data) {
      total += (Math.max(0, d.solar_w_avg) + Math.max(0, d.grid_w_avg) + Math.max(0, d.battery_w_avg)) / 1000;
    }
    return total;
  }, [data, intervalData, useIntervals]);

  const { chartData, yMax, isMultiDay, nowIndex, nowY } = useMemo(() => {
    const multiDay = days > 1;
    // Only treat as "today" if it's actually today's date (not yesterday in daily mode)
    const todayStr = new Date().toISOString().slice(0, 10);
    const dataDate = intervalData?.length ? new Date(intervalData[0].ts).toISOString().slice(0, 10) : null;
    const isToday = !multiDay && dataDate === todayStr;
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    if (useIntervals) {
      // === Downsample to 15-min slots, full 24h x-axis ===
      const SLOTS = 96; // 24h × 4 slots/hour

      // Index interval data by 15-min slot (take first point per slot)
      const slotMap = new Map<number, IntervalPoint>();
      for (const d of intervalData!) {
        const dt = new Date(d.ts);
        const idx = dt.getHours() * 4 + Math.floor(dt.getMinutes() / 15);
        if (!slotMap.has(idx)) slotMap.set(idx, d);
      }

      const nowSlot = isToday ? currentHour * 4 + Math.floor(currentMinute / 15) : SLOTS;
      let lastDataIdx = -1;

      const mapped: ChartPoint[] = Array.from({ length: SLOTS }, (_, i) => {
        const h = Math.floor(i / 4);
        const m = (i % 4) * 15;
        const ampm = h >= 12 ? "PM" : "AM";
        const h12 = h % 12 || 12;
        const label = m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, "0")}`;

        const d = slotMap.get(i);
        if (!d) {
          // Future slot or no data
          if (isToday && i > nowSlot) {
            return { label, solar: null, grid_import: null, battery_discharge: null, home: null, ev: null, grid_export: null, battery_charge: null };
          }
          return { label, ...EMPTY_POINT };
        }

        lastDataIdx = i;
        const grid = d.grid_w;
        const battery = d.battery_w;
        return {
          label,
          solar: Math.max(0, Math.round(d.solar_w)),
          grid_import: Math.max(0, Math.round(grid)),
          battery_discharge: Math.max(0, Math.round(battery)),
          home: -Math.max(0, Math.round(d.home_w - d.vehicle_w)),
          ev: -Math.max(0, Math.round(d.vehicle_w)),
          grid_export: -Math.max(0, Math.round(-grid)),
          battery_charge: -Math.max(0, Math.round(-battery)),
        };
      });

      let maxPos = 0;
      let maxNeg = 0;
      for (const d of mapped) {
        if (d.solar === null) continue;
        const srcTotal = (d.solar || 0) + (d.grid_import || 0) + (d.battery_discharge || 0);
        const sinkTotal = Math.abs(d.home || 0) + Math.abs(d.ev || 0) + Math.abs(d.grid_export || 0) + Math.abs(d.battery_charge || 0);
        maxPos = Math.max(maxPos, srcTotal);
        maxNeg = Math.max(maxNeg, sinkTotal);
      }
      const yBound = Math.max(maxPos, maxNeg) * 1.1;

      // Now dot: last data point
      const lastPt = lastDataIdx >= 0 ? mapped[lastDataIdx] : null;
      const dotY = lastPt ? (lastPt.solar || 0) + (lastPt.grid_import || 0) + (lastPt.battery_discharge || 0) : 0;

      return {
        chartData: mapped,
        yMax: Math.ceil(yBound / 1000) * 1000 || 5000,
        isMultiDay: false,
        nowIndex: isToday && lastDataIdx >= 0 ? lastDataIdx : -1,
        nowY: dotY,
      };
    }

    if (!multiDay) {
      // === Single-day hourly fallback ===
      const hourMap = new Map<number, typeof EMPTY_POINT>();

      for (const d of data) {
        const hour = new Date(d.hour).getHours();
        const grid = d.grid_w_avg;
        const battery = d.battery_w_avg;

        hourMap.set(hour, {
          solar: Math.max(0, Math.round(d.solar_w_avg)),
          grid_import: Math.max(0, Math.round(grid)),
          battery_discharge: Math.max(0, Math.round(battery)),
          home: -Math.max(0, Math.round(d.home_w_avg - d.vehicle_w_avg)),
          ev: -Math.max(0, Math.round(d.vehicle_w_avg)),
          grid_export: -Math.max(0, Math.round(-grid)),
          battery_charge: -Math.max(0, Math.round(-battery)),
        });
      }

      // Hide future hours: set to null for hours after current
      const mapped: ChartPoint[] = HOUR_LABELS.map((label, i) => {
        const hasData = hourMap.has(i);
        if (!hasData && i > currentHour) {
          return { label, solar: null, grid_import: null, battery_discharge: null, home: null, ev: null, grid_export: null, battery_charge: null };
        }
        const pt = hourMap.get(i) || EMPTY_POINT;
        return { label, ...pt };
      });

      let maxPos = 0;
      let maxNeg = 0;
      for (const d of mapped) {
        if (d.solar === null) continue;
        const srcTotal = d.solar + (d.grid_import || 0) + (d.battery_discharge || 0);
        const sinkTotal = Math.abs(d.home || 0) + Math.abs(d.ev || 0) + Math.abs(d.grid_export || 0) + Math.abs(d.battery_charge || 0);
        maxPos = Math.max(maxPos, srcTotal);
        maxNeg = Math.max(maxNeg, sinkTotal);
      }
      const yBound = Math.max(maxPos, maxNeg) * 1.1;

      // Now dot at current hour
      const nowPt = hourMap.get(currentHour);
      const dotY = nowPt ? nowPt.solar + nowPt.grid_import + nowPt.battery_discharge : 0;

      return {
        chartData: mapped,
        yMax: Math.ceil(yBound / 1000) * 1000 || 5000,
        isMultiDay: false,
        nowIndex: currentHour,
        nowY: dotY,
      };
    }

    // === Multi-day: average by hour-of-day ===
    const hourBuckets = new Map<number, { solar: number[]; grid: number[]; battery: number[]; home: number[]; ev: number[] }>();

    for (const d of data) {
      const hour = new Date(d.hour).getHours();
      if (!hourBuckets.has(hour)) {
        hourBuckets.set(hour, { solar: [], grid: [], battery: [], home: [], ev: [] });
      }
      const bucket = hourBuckets.get(hour)!;
      bucket.solar.push(d.solar_w_avg);
      bucket.grid.push(d.grid_w_avg);
      bucket.battery.push(d.battery_w_avg);
      bucket.home.push(d.home_w_avg);
      bucket.ev.push(d.vehicle_w_avg);
    }

    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const mapped: ChartPoint[] = HOUR_LABELS.map((label, i) => {
      const bucket = hourBuckets.get(i);
      if (!bucket) return { label, ...EMPTY_POINT };

      const solarAvg = avg(bucket.solar);
      const gridAvg = avg(bucket.grid);
      const batteryAvg = avg(bucket.battery);
      const homeAvg = avg(bucket.home);
      const evAvg = avg(bucket.ev);

      return {
        label,
        solar: Math.max(0, Math.round(solarAvg)),
        grid_import: Math.max(0, Math.round(gridAvg)),
        battery_discharge: Math.max(0, Math.round(batteryAvg)),
        home: -Math.max(0, Math.round(homeAvg - evAvg)),
        ev: -Math.max(0, Math.round(evAvg)),
        grid_export: -Math.max(0, Math.round(-gridAvg)),
        battery_charge: -Math.max(0, Math.round(-batteryAvg)),
      };
    });

    let maxPos = 0;
    let maxNeg = 0;
    for (const d of mapped) {
      const srcTotal = (d.solar || 0) + (d.grid_import || 0) + (d.battery_discharge || 0);
      const sinkTotal = Math.abs(d.home || 0) + Math.abs(d.ev || 0) + Math.abs(d.grid_export || 0) + Math.abs(d.battery_charge || 0);
      maxPos = Math.max(maxPos, srcTotal);
      maxNeg = Math.max(maxNeg, sinkTotal);
    }
    const yBound = Math.max(maxPos, maxNeg) * 1.1;

    return {
      chartData: mapped,
      yMax: Math.ceil(yBound / 1000) * 1000 || 5000,
      isMultiDay: true,
      nowIndex: -1,
      nowY: 0,
    };
  }, [data, days, intervalData, useIntervals]);

  const title = isMultiDay ? `Average Day (${days} Days)` : "Energy Flow by Hour";
  const fmtKwh = (v: number) => v >= 100 ? `${Math.round(v)} kWh` : `${v.toFixed(1)} kWh`;

  // XAxis tick interval: 3-hour marks (every 12 slots for 96 15-min slots, every 3 for 24 hourly)
  const xInterval = useIntervals ? 11 : 2;

  // Sankey-matched color palette — 70% opacity fills for vibrancy
  const colors = {
    solar:             { stroke: "#facc15", fill: "#facc15b3" },
    grid_import:       { stroke: "#f87171", fill: "#f87171b3" },
    battery_discharge: { stroke: "#34d399", fill: "#34d399b3" },
    home:              { stroke: "#60a5fa", fill: "#60a5fab3" },
    ev:                { stroke: "#a78bfa", fill: "#a78bfab3" },
    grid_export:       { stroke: "#f87171", fill: "#f87171b3" },
    battery_charge:    { stroke: "#2dd4bf", fill: "#2dd4bfb3" },
  };

  const sourceLegend = [
    { label: "Solar", color: colors.solar.stroke },
    { label: "Grid", color: colors.grid_import.stroke },
    { label: "Powerwall", color: colors.battery_discharge.stroke },
  ];
  const consumptionLegend = [
    { label: "Home", color: colors.home.stroke },
    { label: "EV", color: colors.ev.stroke },
    { label: "Grid", color: colors.grid_export.stroke },
    { label: "Powerwall", color: colors.battery_charge.stroke },
  ];

  const LegendRow = ({ items, label }: { items: typeof sourceLegend; label: string }) => (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
      <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <span className="inline-block w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );

  return (
    <div className="card-chart rounded-2xl p-3 sm:p-4 border border-gray-800/50">
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { r: 5; opacity: 1; }
          50% { r: 9; opacity: 0.5; }
        }
        .now-dot { animation: pulse-dot 2s ease-in-out infinite; }
      `}</style>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 mb-3">
        <h2 className="text-sm font-semibold text-gray-400 flex items-center gap-1.5">
          <Activity size={14} className="text-cyan-400" />
          {title}
        </h2>
        <div className="flex gap-3 sm:gap-4 text-[10px]">
          <span className="text-emerald-400">↑ Sources: {fmtKwh(totalEnergy)}</span>
          <span className="text-blue-400">↓ Sinks: {fmtKwh(totalEnergy)}</span>
        </div>
      </div>

      {/* Sources legend — centered above chart */}
      <div className="flex justify-center mb-1">
        <LegendRow items={sourceLegend} label="Sources ↑" />
      </div>

      <ResponsiveContainer width="100%" height={280} className="sm:!h-[500px]">
        <AreaChart data={chartData} margin={{ top: 10, right: 5, bottom: 0, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="#6b7280"
            fontSize={10}
            interval={xInterval}
            tick={{ dy: 4 }}
            tickLine={false}
          />
          <YAxis hide domain={[-yMax, yMax]} />
          <ReferenceLine y={0} stroke="#6b7280" strokeWidth={1.5} />
          <Tooltip content={<CustomTooltip />} />

          {/* Sources — stacked above zero */}
          <Area type="monotone" dataKey="solar" stackId="src" stroke="none" fill={colors.solar.fill} name="Solar" connectNulls={false} />
          <Area type="monotone" dataKey="grid_import" stackId="src" stroke="none" fill={colors.grid_import.fill} name="Grid" connectNulls={false} />
          <Area type="monotone" dataKey="battery_discharge" stackId="src" stroke="none" fill={colors.battery_discharge.fill} name="Powerwall" connectNulls={false} />

          {/* Consumption — stacked below zero */}
          <Area type="monotone" dataKey="home" stackId="sink" stroke="none" fill={colors.home.fill} name="Home" connectNulls={false} />
          <Area type="monotone" dataKey="ev" stackId="sink" stroke="none" fill={colors.ev.fill} name="EV" connectNulls={false} />
          <Area type="monotone" dataKey="grid_export" stackId="sink" stroke="none" fill={colors.grid_export.fill} name="Grid" connectNulls={false} />
          <Area type="monotone" dataKey="battery_charge" stackId="sink" stroke="none" fill={colors.battery_charge.fill} name="Powerwall" connectNulls={false} />

          {/* Pulsing "Now" dot — single-day only */}
          {!isMultiDay && nowIndex >= 0 && (
            <ReferenceDot x={chartData[nowIndex]?.label} y={nowY} r={6} fill="#22d3ee" stroke="#22d3ee" strokeWidth={2} className="now-dot" />
          )}
        </AreaChart>
      </ResponsiveContainer>

      {/* Consumption legend — centered below chart */}
      <div className="flex justify-center mt-1">
        <LegendRow items={consumptionLegend} label="Sinks ↓" />
      </div>
    </div>
  );
}
