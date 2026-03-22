"use client";

import { useMemo } from "react";
import { Sun, Zap } from "lucide-react";
import type { DailySummary } from "@/lib/api";

function fmt(v: number): string {
  if (v >= 100) return `$${Math.round(v)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(2)}`;
}

interface Props {
  data: DailySummary[];
  days: number;
}

export default function CostTiles({ data, days }: Props) {
  const { solarSavings, gridCosts } = useMemo(() => {
    if (data.length === 0) return { solarSavings: 0, gridCosts: 0 };

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

    const avgRate = totalImportKwh > 0 ? totalCost / totalImportKwh : 0.33;
    const solarBatterySavings = solarSelfConsumedKwh * avgRate;

    return {
      solarSavings: solarBatterySavings + exportCredit,
      gridCosts: totalCost,
    };
  }, [data]);

  const label = days === 1 ? "Today" : `${days} Days`;

  return (
    <>
      {/* Solar Savings */}
      <div className="bg-gray-900 rounded-xl p-3 sm:p-4 border border-gray-800 flex flex-col items-center justify-center text-center">
        <h2 className="text-sm font-semibold text-gray-400 mb-1">Solar Savings</h2>
        <div className="flex-1 flex flex-col items-center justify-center py-4 sm:py-6">
          <Sun size={24} className="text-yellow-400 mb-3" />
          <p className="text-4xl sm:text-6xl font-bold text-yellow-400">
            {fmt(solarSavings)}
          </p>
          <span className="text-xs sm:text-sm text-gray-500 mt-1">
            solar + battery + export credits
          </span>
        </div>
      </div>

      {/* Grid Costs */}
      <div className="bg-gray-900 rounded-xl p-3 sm:p-4 border border-gray-800 flex flex-col items-center justify-center text-center">
        <h2 className="text-sm font-semibold text-gray-400 mb-1">Grid Costs</h2>
        <div className="flex-1 flex flex-col items-center justify-center py-4 sm:py-6">
          <Zap size={24} className="text-red-400 mb-3" />
          <p className="text-4xl sm:text-6xl font-bold text-red-400">
            {fmt(gridCosts)}
          </p>
          <span className="text-xs sm:text-sm text-gray-500 mt-1">
            total grid import costs
          </span>
        </div>
      </div>
    </>
  );
}
