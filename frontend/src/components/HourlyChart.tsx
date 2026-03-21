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
  Legend,
  ReferenceLine,
} from "recharts";
import { Activity } from "lucide-react";
import type { HourlyBucket } from "@/lib/api";

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
          <span className="text-gray-500">Consumption</span>
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

interface Props {
  data: HourlyBucket[];
  days?: number; // 1 = single-day (hourly view), >1 = multi-day (daily aggregated)
}

export default function HourlyChart({ data, days = 1 }: Props) {
  // Compute totals from RAW data (before rounding) so sources always equals consumption
  const totalEnergy = useMemo(() => {
    let total = 0;
    for (const d of data) {
      // Sum source side: solar + grid_import + battery_discharge
      total += (Math.max(0, d.solar_w_avg) + Math.max(0, d.grid_w_avg) + Math.max(0, d.battery_w_avg)) / 1000;
    }
    return total;
  }, [data]);

  const { chartData, yMax, isMultiDay } = useMemo(() => {
    const multiDay = days > 1;

    if (!multiDay) {
      // === Single-day: show 24-hour buckets ===
      const hourMap = new Map<number, typeof EMPTY_POINT>();

      for (const d of data) {
        const hour = new Date(d.hour).getHours();
        const grid = d.grid_w_avg;
        const battery = d.battery_w_avg;

        const solar = Math.max(0, Math.round(d.solar_w_avg));
        const grid_import = Math.max(0, Math.round(grid));
        const battery_discharge = Math.max(0, Math.round(battery));
        const home = -Math.max(0, Math.round(d.home_w_avg - d.vehicle_w_avg));
        const ev = -Math.max(0, Math.round(d.vehicle_w_avg));
        const grid_export = -Math.max(0, Math.round(-grid));
        const battery_charge = -Math.max(0, Math.round(-battery));

        hourMap.set(hour, { solar, grid_import, battery_discharge, home, ev, grid_export, battery_charge });
      }

      const mapped = HOUR_LABELS.map((label, i) => ({
        label,
        ...(hourMap.get(i) || EMPTY_POINT),
      }));

      let maxPos = 0;
      let maxNeg = 0;
      for (const d of mapped) {
        const srcTotal = d.solar + d.grid_import + d.battery_discharge;
        const sinkTotal = Math.abs(d.home) + Math.abs(d.ev) + Math.abs(d.grid_export) + Math.abs(d.battery_charge);
        maxPos = Math.max(maxPos, srcTotal);
        maxNeg = Math.max(maxNeg, sinkTotal);
      }
      const yBound = Math.max(maxPos, maxNeg) * 1.1;

      return {
        chartData: mapped,
        yMax: Math.ceil(yBound / 1000) * 1000 || 5000,
        isMultiDay: false,
      };
    }

    // === Multi-day: average all hourly buckets by hour-of-day into a single 24h profile ===
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

    const mapped = HOUR_LABELS.map((label, i) => {
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
      const srcTotal = d.solar + d.grid_import + d.battery_discharge;
      const sinkTotal = Math.abs(d.home) + Math.abs(d.ev) + Math.abs(d.grid_export) + Math.abs(d.battery_charge);
      maxPos = Math.max(maxPos, srcTotal);
      maxNeg = Math.max(maxNeg, sinkTotal);
    }
    const yBound = Math.max(maxPos, maxNeg) * 1.1;

    return {
      chartData: mapped,
      yMax: Math.ceil(yBound / 1000) * 1000 || 5000,
      isMultiDay: true,
    };
  }, [data, days]);

  const title = isMultiDay ? `Average Day (${days} Days)` : "24-Hour Energy Flow";

  const fmtKwh = (v: number) => v >= 100 ? `${Math.round(v)} kWh` : `${v.toFixed(1)} kWh`;

  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-sm font-semibold text-gray-400 flex items-center gap-1.5">
          <Activity size={14} className="text-cyan-400" />
          {title}
        </h2>
        <div className="flex gap-4 text-[10px]">
          <span className="text-emerald-400">↑ Sources: {fmtKwh(totalEnergy)}</span>
          <span className="text-blue-400">↓ Consumption: {fmtKwh(totalEnergy)}</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={360}>
        <AreaChart data={chartData} margin={{ top: 10, right: 30, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="label"
            stroke="#6b7280"
            fontSize={10}
            interval={2}
            tick={{ dy: 4 }}
          />
          <YAxis
            stroke="#6b7280"
            fontSize={11}
            domain={[-yMax, yMax]}
            tickFormatter={(v) => formatW(Math.abs(v))}
          />
          <ReferenceLine y={0} stroke="#6b7280" strokeWidth={1.5} />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            formatter={(value) => <span className="text-xs text-gray-400">{value}</span>}
          />

          {/* Sources — stacked above zero */}
          <Area
            type="monotone"
            dataKey="solar"
            stackId="src"
            stroke="#facc15"
            fill="#facc1550"
            name="Solar"
          />
          <Area
            type="monotone"
            dataKey="grid_import"
            stackId="src"
            stroke="#f87171"
            fill="#f8717150"
            name="Grid Import"
          />
          <Area
            type="monotone"
            dataKey="battery_discharge"
            stackId="src"
            stroke="#34d399"
            fill="#34d39950"
            name="Powerwall Discharge"
          />

          {/* Consumption — stacked below zero */}
          <Area
            type="monotone"
            dataKey="home"
            stackId="sink"
            stroke="#60a5fa"
            fill="#60a5fa50"
            name="Home"
          />
          <Area
            type="monotone"
            dataKey="ev"
            stackId="sink"
            stroke="#a78bfa"
            fill="#a78bfa50"
            name="EV"
          />
          <Area
            type="monotone"
            dataKey="grid_export"
            stackId="sink"
            stroke="#fb923c"
            fill="#fb923c50"
            name="Grid Export"
          />
          <Area
            type="monotone"
            dataKey="battery_charge"
            stackId="sink"
            stroke="#2dd4bf"
            fill="#2dd4bf50"
            name="Battery Charge"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
