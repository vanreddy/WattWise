"use client";

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
import type { DailySummary } from "@/lib/api";

export default function CostBarChart({ data }: { data: DailySummary[] }) {
  const chartData = [...data]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((d) => ({
      day: new Date(d.day).toLocaleDateString([], {
        weekday: "short",
        month: "numeric",
        day: "numeric",
      }),
      peak: Number(d.peak_cost.toFixed(2)),
      part_peak: Number(d.part_peak_cost.toFixed(2)),
      off_peak: Number(d.off_peak_cost.toFixed(2)),
    }));

  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
      <h2 className="text-sm font-semibold text-gray-400 mb-3">
        7-Day Cost Breakdown
      </h2>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis dataKey="day" stroke="#6b7280" fontSize={11} />
          <YAxis
            stroke="#6b7280"
            fontSize={11}
            tickFormatter={(v) => `$${v}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1f2937",
              border: "1px solid #374151",
              borderRadius: "8px",
            }}
            formatter={(value: number) => `$${value.toFixed(2)}`}
          />
          <Legend />
          <Bar dataKey="peak" stackId="cost" fill="#ef4444" name="Peak" />
          <Bar
            dataKey="part_peak"
            stackId="cost"
            fill="#f59e0b"
            name="Part Peak"
          />
          <Bar
            dataKey="off_peak"
            stackId="cost"
            fill="#22c55e"
            name="Off Peak"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
