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
    <div className="grid grid-cols-2 gap-4">
      {/* Solar Savings */}
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 flex flex-col items-center justify-center text-center">
        <Sun size={20} className="text-yellow-400 mb-2" />
        <p className="text-[11px] text-gray-500 mb-1">Solar Savings ({label})</p>
        <p className="text-2xl sm:text-3xl font-bold text-yellow-400">
          {fmt(solarSavings)}
        </p>
        <p className="text-[10px] text-gray-600 mt-1">
          Solar + battery + export credits
        </p>
      </div>

      {/* Grid Costs */}
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 flex flex-col items-center justify-center text-center">
        <Zap size={20} className="text-red-400 mb-2" />
        <p className="text-[11px] text-gray-500 mb-1">Grid Costs ({label})</p>
        <p className="text-2xl sm:text-3xl font-bold text-red-400">
          {fmt(gridCosts)}
        </p>
        <p className="text-[10px] text-gray-600 mt-1">
          Total grid import costs
        </p>
      </div>
    </div>
  );
}
