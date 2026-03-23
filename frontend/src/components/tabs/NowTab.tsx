"use client";

import { useMemo } from "react";
import type { SummaryResponse, Alert } from "@/lib/api";
import PowerFlowCards from "@/components/PowerFlowCards";
import LiveSankeyChart from "@/components/LiveSankeyChart";
import AlertsList from "@/components/AlertsList";

function LiveSelfPowered({ current }: { current: SummaryResponse["current"] }) {
  const selfPowered = useMemo(() => {
    const home = Math.max(0, current.home_w);
    if (home === 0) return 100;
    const gridImport = Math.max(0, current.grid_w);
    return Math.max(0, Math.min(100, ((home - gridImport) / home) * 100));
  }, [current]);

  const pct = Math.round(selfPowered);

  // Color: red (0%) → yellow (50%) → green (100%)
  let color: string;
  if (pct >= 90) color = "text-emerald-400";
  else if (pct >= 50) color = "text-yellow-400";
  else color = "text-red-400";

  let bgGlow: string;
  if (pct >= 90) bgGlow = "shadow-emerald-500/10";
  else if (pct >= 50) bgGlow = "shadow-yellow-500/10";
  else bgGlow = "shadow-red-500/10";

  return (
    <div className={`bg-gray-900 rounded-xl p-4 border border-gray-800 text-center shadow-lg ${bgGlow}`}>
      <p className="text-xs text-gray-500 mb-1">Self-Powered Right Now</p>
      <p className={`text-5xl sm:text-6xl font-bold ${color} tabular-nums`}>
        {pct}%
      </p>
      <p className="text-xs text-gray-600 mt-1">
        {current.grid_w <= 0 ? "Exporting to grid" : "Importing from grid"}
      </p>
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
  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex justify-between items-center text-xs text-gray-500">
        <span>
          {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : ""}
        </span>
        {error && <span className="text-yellow-500">Refresh failed</span>}
      </div>

      {/* Live self-powered indicator */}
      <LiveSelfPowered current={summary.current} />

      {/* Animated live Sankey */}
      <LiveSankeyChart current={summary.current} />

      {/* Live stats cards */}
      <PowerFlowCards current={summary.current} today={summary.today} />

      {/* Alerts */}
      <AlertsList alerts={alerts} />
    </div>
  );
}
