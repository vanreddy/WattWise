"use client";

import type { SummaryResponse } from "@/lib/api";
import LiveSankeyChart from "@/components/LiveSankeyChart";

interface Props {
  summary: SummaryResponse;
  lastUpdated: Date | null;
  error: string | null;
}

export default function NowTab({ summary, lastUpdated, error }: Props) {
  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex justify-between items-center text-xs text-gray-500">
        <span>
          {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : ""}
        </span>
        {error && <span className="text-yellow-500">Refresh failed</span>}
      </div>

      {/* Animated live Sankey with integrated self-powered ring */}
      <LiveSankeyChart current={summary.current} />
    </div>
  );
}
