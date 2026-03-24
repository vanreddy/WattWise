"use client";

import { useMemo, useEffect, useState, useRef } from "react";
import { Sun, Zap } from "lucide-react";
import type { DailySummary } from "@/lib/api";

// Tick-up animation hook for dollar amounts
function useTickUp(target: number, duration = 1000, delay = 0): number {
  const [value, setValue] = useState(0);
  const startTime = useRef<number | null>(null);
  const prevTarget = useRef(0);

  useEffect(() => {
    if (target <= 0) { setValue(0); return; }

    const from = prevTarget.current;
    prevTarget.current = target;

    const timeout = setTimeout(() => {
      const tick = (timestamp: number) => {
        if (!startTime.current) startTime.current = timestamp;
        const elapsed = timestamp - startTime.current;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(from + eased * (target - from));
        if (progress < 1) requestAnimationFrame(tick);
      };
      startTime.current = null;
      requestAnimationFrame(tick);
    }, delay);

    return () => clearTimeout(timeout);
  }, [target, duration, delay]);

  return value;
}

function fmt(v: number): string {
  if (v >= 100) return `$${Math.round(v)}`;
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

  const animatedSavings = useTickUp(solarSavings, 1200, 100);
  const animatedCosts = useTickUp(gridCosts, 1200, 300);

  return (
    <>
      {/* Solar Savings */}
      <div className="card-elevated rounded-2xl p-3 sm:p-4 border border-gray-800/50 flex flex-col items-center justify-center text-center">
        <h2 className="text-sm font-semibold text-gray-400 mb-1">Self-Power Savings</h2>
        <div className="flex-1 flex flex-col items-center justify-center py-4 sm:py-6">
          <Sun size={24} className="text-green-400 mb-3" />
          <p className="text-4xl sm:text-6xl font-bold text-green-400 tabular-nums">
            {fmt(animatedSavings)}
          </p>
          <span className="text-xs sm:text-sm text-gray-500 mt-1">
            solar + battery + export credits
          </span>
        </div>
      </div>

      {/* Grid Costs */}
      <div className="card-elevated rounded-2xl p-3 sm:p-4 border border-gray-800/50 flex flex-col items-center justify-center text-center">
        <h2 className="text-sm font-semibold text-gray-400 mb-1">Grid Costs</h2>
        <div className="flex-1 flex flex-col items-center justify-center py-4 sm:py-6">
          <Zap size={24} className="text-red-400 mb-3" />
          <p className="text-4xl sm:text-6xl font-bold text-red-400 tabular-nums">
            {fmt(animatedCosts)}
          </p>
          <span className="text-xs sm:text-sm text-gray-500 mt-1">
            total grid import costs
          </span>
        </div>
      </div>
    </>
  );
}
