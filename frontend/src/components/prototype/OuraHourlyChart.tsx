"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface HourlyDataPoint {
  hour: string;
  solar: number;
  home: number;
  grid: number;
  battery: number;
}

interface Props {
  data: HourlyDataPoint[];
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div
      style={{
        background: "rgba(255, 255, 255, 0.95)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderRadius: "12px",
        border: "1px solid #ebebeb",
        boxShadow: "0 6px 24px rgba(74, 71, 65, 0.1)",
        padding: "10px 14px",
      }}
    >
      <p
        style={{
          fontSize: "11px",
          color: "#aaaaaa",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          marginBottom: "6px",
        }}
      >
        {label}
      </p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: entry.color }}
            />
            <span style={{ fontSize: "12px", color: "#8a8680" }}>
              {entry.name}
            </span>
          </div>
          <span
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: "13px",
              color: "#4A4741",
            }}
          >
            {entry.value.toFixed(1)} kWh
          </span>
        </div>
      ))}
    </div>
  );
}

export default function OuraHourlyChart({ data }: Props) {
  return (
    <div className="space-y-3">
      <p
        className="uppercase tracking-widest px-1"
        style={{
          fontSize: "11px",
          color: "#aaaaaa",
          letterSpacing: "0.15em",
        }}
      >
        24-Hour Energy Profile
      </p>

      <div
        style={{
          background: "rgba(255, 255, 255, 0.7)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderRadius: "16px",
          border: "1px solid rgba(235, 235, 235, 0.8)",
          boxShadow: "0 6px 24px rgba(74, 71, 65, 0.06)",
          padding: "1.25rem 1rem 0.75rem",
        }}
      >
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart
            data={data}
            margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
          >
            <defs>
              <linearGradient id="oura-solar-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f5a623" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f5a623" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="oura-home-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#51b7e0" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#51b7e0" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="oura-grid-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#e07851" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#e07851" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="oura-battery-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#9b7de0" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#9b7de0" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#ebebeb"
              vertical={false}
            />
            <XAxis
              dataKey="hour"
              tick={{ fontSize: 10, fill: "#aaaaaa" }}
              tickLine={false}
              axisLine={{ stroke: "#ebebeb" }}
              interval={2}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#aaaaaa" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v}`}
              unit=" kWh"
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={0} stroke="#d4d0cb" strokeWidth={1} />

            <Area
              type="monotone"
              dataKey="solar"
              name="Solar"
              stroke="#f5a623"
              strokeWidth={2}
              fill="url(#oura-solar-grad)"
              dot={false}
              activeDot={{ r: 4, fill: "#f5a623", stroke: "#fff", strokeWidth: 2 }}
            />
            <Area
              type="monotone"
              dataKey="home"
              name="Home"
              stroke="#51b7e0"
              strokeWidth={2}
              fill="url(#oura-home-grad)"
              dot={false}
              activeDot={{ r: 4, fill: "#51b7e0", stroke: "#fff", strokeWidth: 2 }}
            />
            <Area
              type="monotone"
              dataKey="grid"
              name="Grid"
              stroke="#e07851"
              strokeWidth={1.5}
              fill="url(#oura-grid-grad)"
              dot={false}
              activeDot={{ r: 3, fill: "#e07851", stroke: "#fff", strokeWidth: 2 }}
            />
            <Area
              type="monotone"
              dataKey="battery"
              name="Battery"
              stroke="#9b7de0"
              strokeWidth={1.5}
              fill="url(#oura-battery-grad)"
              dot={false}
              activeDot={{ r: 3, fill: "#9b7de0", stroke: "#fff", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div className="flex items-center justify-center gap-5 mt-2 pb-1">
          {[
            { name: "Solar", color: "#f5a623" },
            { name: "Home", color: "#51b7e0" },
            { name: "Grid", color: "#e07851" },
            { name: "Battery", color: "#9b7de0" },
          ].map((item) => (
            <div key={item.name} className="flex items-center gap-1.5">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: item.color }}
              />
              <span style={{ fontSize: "11px", color: "#aaaaaa" }}>
                {item.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
