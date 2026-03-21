"use client";

import { Sun, Home, Zap, Battery } from "lucide-react";
import type { CurrentPower, TodayTotals } from "@/lib/api";

function formatW(w: number): string {
  if (Math.abs(w) >= 1000) return `${(w / 1000).toFixed(1)} kW`;
  return `${Math.round(w)} W`;
}

function FlowCard({
  label,
  value,
  color,
  icon,
  sub,
}: {
  label: string;
  value: string;
  color: string;
  icon: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
      <div className="flex items-center gap-1.5 text-sm text-gray-400 mb-1">
        {icon}
        {label}
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

export default function PowerFlowCards({
  current,
  today,
}: {
  current: CurrentPower;
  today: TodayTotals;
}) {
  const gridLabel = current.grid_w > 0 ? "Importing" : "Exporting";
  const batteryLabel = current.battery_w > 0 ? "Discharging" : "Charging";

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <FlowCard
        label="Solar"
        value={formatW(current.solar_w)}
        color="text-yellow-400"
        icon={<Sun size={14} className="text-yellow-400" />}
      />
      <FlowCard
        label="Home"
        value={formatW(current.home_w)}
        color="text-blue-400"
        icon={<Home size={14} className="text-blue-400" />}
      />
      <FlowCard
        label={`Grid (${gridLabel})`}
        value={formatW(Math.abs(current.grid_w))}
        color={current.grid_w > 0 ? "text-red-400" : "text-green-400"}
        icon={<Zap size={14} className={current.grid_w > 0 ? "text-red-400" : "text-green-400"} />}
      />
      <FlowCard
        label={`Battery (${batteryLabel})`}
        value={`${current.battery_pct.toFixed(0)}%`}
        color="text-emerald-400"
        icon={<Battery size={14} className="text-emerald-400" />}
      />
    </div>
  );
}
