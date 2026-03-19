"use client";

import type { DailySummary } from "@/lib/api";

export default function BatteryGauge({
  batteryPct,
  dailyData,
}: {
  batteryPct: number;
  dailyData: DailySummary[];
}) {
  const recentDays = [...dailyData]
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, 7);

  const avgCoverage =
    recentDays.length > 0
      ? recentDays.reduce(
          (sum, d) => sum + (d.battery_peak_coverage_pct ?? 0),
          0
        ) / recentDays.length
      : 0;

  // EV stats for the week
  const weekEvKwh = recentDays.reduce((sum, d) => sum + d.ev_kwh, 0);
  const weekEvCost = recentDays.reduce((sum, d) => sum + d.ev_cost, 0);

  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 space-y-4">
      {/* Battery SOC */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 mb-2">
          Powerwall
        </h2>
        <div className="flex items-end gap-3">
          <span className="text-3xl font-bold text-emerald-400">
            {batteryPct.toFixed(0)}%
          </span>
          <span className="text-sm text-gray-500 pb-1">current charge</span>
        </div>
        <div className="mt-2 h-3 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all"
            style={{ width: `${Math.min(batteryPct, 100)}%` }}
          />
        </div>
      </div>

      {/* Peak Coverage */}
      <div>
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-400">7-Day Peak Coverage</span>
          <span className="text-white font-medium">
            {avgCoverage.toFixed(0)}%
          </span>
        </div>
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full"
            style={{ width: `${Math.min(avgCoverage, 100)}%` }}
          />
        </div>
      </div>

      {/* EV This Week */}
      <div className="pt-2 border-t border-gray-800">
        <h3 className="text-sm font-semibold text-gray-400 mb-1">
          EV Charging (7 days)
        </h3>
        <div className="flex justify-between text-sm">
          <span className="text-gray-300">{weekEvKwh.toFixed(1)} kWh</span>
          <span className="text-gray-300">${weekEvCost.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
