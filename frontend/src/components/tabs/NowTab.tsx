"use client";

import { useMemo } from "react";
import { Battery } from "lucide-react";
import type { SummaryResponse, Alert } from "@/lib/api";
import LiveSankeyChart from "@/components/LiveSankeyChart";
import SelfPoweredRing from "@/components/SelfPoweredRing";
import AlertsList from "@/components/AlertsList";

function BatteryStatus({ batteryPct, batteryW }: { batteryPct: number; batteryW: number }) {
  const pct = Math.round(batteryPct);
  const isCharging = batteryW < -10;
  const isDischarging = batteryW > 10;
  const status = isCharging ? "Charging" : isDischarging ? "Discharging" : "Idle";

  let color: string;
  if (pct >= 60) color = "text-emerald-400";
  else if (pct >= 20) color = "text-yellow-400";
  else color = "text-red-400";

  let barColor: string;
  if (pct >= 60) barColor = "bg-emerald-400";
  else if (pct >= 20) barColor = "bg-yellow-400";
  else barColor = "bg-red-400";

  return (
    <div className="bg-gray-900 rounded-xl p-3 sm:p-4 border border-gray-800 flex items-center gap-3">
      <Battery size={20} className={color} />
      <div className="flex-1">
        <div className="flex justify-between items-baseline mb-1">
          <span className="text-sm font-semibold text-gray-300">Powerwall</span>
          <span className={`text-lg font-bold tabular-nums ${color}`}>{pct}%</span>
        </div>
        <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-[10px] text-gray-500 mt-1">{status}</p>
      </div>
    </div>
  );
}

interface Props {
  summary: SummaryResponse;
  alerts: Alert[];
  lastUpdated: Date | null;
  error: string | null;
}

export default function NowTab({ summary, alerts, lastUpdated, error }: Props) {
  const selfPoweredPct = useMemo(() => {
    const home = Math.max(0, summary.current.home_w);
    if (home === 0) return 100;
    const gridImport = Math.max(0, summary.current.grid_w);
    return Math.max(0, Math.min(100, ((home - gridImport) / home) * 100));
  }, [summary.current]);

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex justify-between items-center text-xs text-gray-500">
        <span>
          {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : ""}
        </span>
        {error && <span className="text-yellow-500">Refresh failed</span>}
      </div>

      {/* Live self-powering ring */}
      <SelfPoweredRing selfPoweredPct={selfPoweredPct} label="Self-Powering" />

      {/* Animated live Sankey */}
      <LiveSankeyChart current={summary.current} />

      {/* Powerwall status */}
      <BatteryStatus
        batteryPct={summary.current.battery_pct}
        batteryW={summary.current.battery_w}
      />

      {/* Alerts */}
      <AlertsList alerts={alerts} />
    </div>
  );
}
