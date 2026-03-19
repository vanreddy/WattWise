"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  LabelList,
} from "recharts";
import { DollarSign } from "lucide-react";
import type { DailySummary } from "@/lib/api";

interface WaterfallBar {
  name: string;
  base: number;   // invisible spacer
  value: number;   // visible bar height
  total: number;   // actual value shown in tooltip
  color: string;
  type: "increase" | "decrease" | "total";
  displayLabel: string; // label shown on bar
}

function computeWaterfall(data: DailySummary[]): WaterfallBar[] {
  if (data.length === 0) return [];

  let totalImportKwh = 0;
  let totalCost = 0;
  let solarSelfConsumedKwh = 0;
  let exportCredit = 0;

  for (const d of data) {
    totalImportKwh += d.total_import_kwh;
    totalCost += d.total_cost;
    solarSelfConsumedKwh += d.solar_self_consumed_kwh;
    exportCredit += d.export_credit;
  }

  // Weighted average import rate ($/kWh)
  const avgRate = totalImportKwh > 0 ? totalCost / totalImportKwh : 0.33;

  // Grid-only hypothetical: all consumption from grid
  const totalConsumptionKwh = totalImportKwh + solarSelfConsumedKwh;
  const gridOnlyCost = totalConsumptionKwh * avgRate;

  // Solar + battery savings = grid cost you avoided by self-consuming solar
  const solarBatterySavings = solarSelfConsumedKwh * avgRate;

  // Net cost = what you actually pay
  const netCost = totalCost - exportCredit;

  const fmt = (v: number) => `$${Math.abs(v).toFixed(2)}`;

  // Build waterfall bars
  const bars: WaterfallBar[] = [];

  // 1. Grid-only cost (starting bar)
  bars.push({
    name: "Grid Only",
    base: 0,
    value: gridOnlyCost,
    total: gridOnlyCost,
    color: "#ef4444",
    type: "increase",
    displayLabel: fmt(gridOnlyCost),
  });

  // 2. Solar + Battery savings (negative, hanging from previous)
  let running = gridOnlyCost;
  bars.push({
    name: "Solar + Battery\nSavings",
    base: running - solarBatterySavings,
    value: solarBatterySavings,
    total: -solarBatterySavings,
    color: "#facc15",
    type: "decrease",
    displayLabel: `-${fmt(solarBatterySavings)}`,
  });
  running -= solarBatterySavings;

  // 3. Export credits (negative, hanging from previous)
  bars.push({
    name: "Export\nCredits",
    base: running - exportCredit,
    value: exportCredit,
    total: -exportCredit,
    color: "#34d399",
    type: "decrease",
    displayLabel: `-${fmt(exportCredit)}`,
  });
  running -= exportCredit;

  // 4. Net cost (total bar from zero)
  bars.push({
    name: "Net Cost",
    base: 0,
    value: Math.max(0, netCost),
    total: netCost,
    color: "#60a5fa",
    type: "total",
    displayLabel: fmt(netCost),
  });

  return bars;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const bar = payload[0]?.payload as WaterfallBar | undefined;
  if (!bar) return null;

  const isNegative = bar.type === "decrease";
  const displayValue = Math.abs(bar.total);
  const sign = isNegative ? "-" : "";

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-xs">
      <div className="text-gray-400 mb-1">{bar.name.replace("\n", " ")}</div>
      <div className="text-gray-200 font-semibold text-sm">
        {sign}${displayValue.toFixed(2)}
      </div>
    </div>
  );
}

// Custom label renderer for on-bar labels
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function BarLabel(props: any) {
  const { x, y, width, index, data } = props;
  if (index == null || !data || !data[index]) return null;
  const label = data[index].displayLabel;
  if (!label) return null;

  return (
    <text
      x={x + width / 2}
      y={y - 8}
      textAnchor="middle"
      fontSize={12}
      fontWeight={600}
      fill="#e5e7eb"
    >
      {label}
    </text>
  );
}

interface Props {
  data: DailySummary[];
  days: number;
}

export default function CostWaterfallChart({ data, days }: Props) {
  const bars = useMemo(() => computeWaterfall(data), [data]);

  if (bars.length === 0) {
    return (
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <h2 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-1.5">
          <DollarSign size={14} className="text-green-400" />
          Cost Waterfall
        </h2>
        <div className="flex items-center justify-center h-[260px] text-gray-500 text-sm">
          No cost data for this period
        </div>
      </div>
    );
  }

  const title = days === 1 ? "Today's Cost Waterfall" : `Cost Waterfall (${days} Days)`;

  // Find max for Y axis
  const maxVal = Math.max(...bars.map((b) => b.base + b.value)) * 1.2;

  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
      <h2 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-1.5">
        <DollarSign size={14} className="text-green-400" />
        {title}
      </h2>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={bars} margin={{ top: 28, right: 10, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
          <XAxis
            dataKey="name"
            stroke="#6b7280"
            fontSize={11}
            tick={{ fill: "#9ca3af" }}
            interval={0}
          />
          <YAxis
            stroke="#6b7280"
            fontSize={11}
            tickFormatter={(v) => `$${v.toFixed(0)}`}
            domain={[0, maxVal]}
          />
          <ReferenceLine y={0} stroke="#6b7280" />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.05)" }} />

          {/* Invisible base bar (spacer) */}
          <Bar dataKey="base" stackId="waterfall" fill="transparent" isAnimationActive={false} />

          {/* Visible value bar with labels */}
          <Bar dataKey="value" stackId="waterfall" radius={[4, 4, 0, 0]} isAnimationActive={true}>
            {bars.map((bar, i) => (
              <Cell key={i} fill={bar.color} fillOpacity={0.85} />
            ))}
            <LabelList
              dataKey="value"
              content={(props) => <BarLabel {...props} data={bars} />}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-4 mt-3 text-[10px] text-gray-400">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" />
          Hypothetical grid-only cost
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-yellow-400 inline-block" />
          Solar + battery savings
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400 inline-block" />
          Export credits
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-blue-400 inline-block" />
          What you pay
        </span>
      </div>
    </div>
  );
}
