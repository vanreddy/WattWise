"use client";

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

export default function HourlyChart({ data }: { data: HourlyBucket[] }) {
  const chartData = data.map((d) => {
    const grid = d.grid_w_avg;
    const battery = d.battery_w_avg;
    return {
      hour_label: new Date(d.hour).toLocaleTimeString([], {
        hour: "numeric",
        hour12: true,
      }),
      // Sources (positive, above axis)
      solar: Math.max(0, Math.round(d.solar_w_avg)),
      grid_import: Math.max(0, Math.round(grid)),
      battery_discharge: Math.max(0, Math.round(-battery)),

      // Consumption (negative, below axis)
      home: -Math.round(d.home_w_avg),
      ev: -Math.round(d.vehicle_w_avg),
      grid_export: -Math.max(0, Math.round(-grid)),
      battery_charge: -Math.max(0, Math.round(battery)),
    };
  });

  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-sm font-semibold text-gray-400">
          24-Hour Energy Flow
        </h2>
        <div className="flex gap-4 text-[10px] text-gray-500">
          <span>↑ Sources</span>
          <span>↓ Consumption</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={360}>
        <AreaChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis dataKey="hour_label" stroke="#6b7280" fontSize={11} />
          <YAxis
            stroke="#6b7280"
            fontSize={11}
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
