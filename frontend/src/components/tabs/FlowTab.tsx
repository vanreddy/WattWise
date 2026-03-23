"use client";

import { useState, useCallback } from "react";
import { useSwipeable } from "react-swipeable";
import type { DailySummary, HourlyBucket, Alert, SankeyFlows, IntervalPoint } from "@/lib/api";
import type { DateRange } from "@/hooks/useDashboardData";
import PeriodSelector, { computeRange, type Mode } from "@/components/PeriodSelector";
import SelfPoweredRing from "@/components/SelfPoweredRing";
import SankeyChart from "@/components/SankeyChart";
import HourlyChart from "@/components/HourlyChart";
import AlertsList from "@/components/AlertsList";

interface Props {
  daily: DailySummary[];
  hourly: HourlyBucket[];
  alerts: Alert[];
  intervalData: IntervalPoint[];
  sankeyFlows: SankeyFlows | null;
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  backfillActive: boolean;
}

export default function FlowTab({
  daily,
  hourly,
  alerts,
  intervalData,
  sankeyFlows,
  dateRange,
  setDateRange,
  backfillActive,
}: Props) {
  const [mode, setMode] = useState<Mode>("daily");
  const [offset, setOffset] = useState(0);
  const [swipeDir, setSwipeDir] = useState<"left" | "right" | null>(null);

  const navigate = useCallback(
    (dir: -1 | 1) => {
      const newOffset = offset + dir;
      if (newOffset > 0) return;
      setOffset(newOffset);
      setSwipeDir(dir === -1 ? "right" : "left");
      const range = computeRange(mode, newOffset);
      setDateRange(range);
      // Reset swipe animation
      setTimeout(() => setSwipeDir(null), 300);
    },
    [mode, offset, setDateRange]
  );

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => navigate(-1),
    onSwipedRight: () => navigate(1),
    trackMouse: false,
    delta: 50,
  });

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    setOffset(0);
  };

  const handlePeriodChange = (range: DateRange) => {
    setDateRange(range);
  };

  // Compute self-powered %
  let gridImport = 0;
  let totalConsumption = 0;
  if (sankeyFlows) {
    gridImport = sankeyFlows.grid_to_home + sankeyFlows.grid_to_battery;
    totalConsumption = sankeyFlows.solar_to_home + sankeyFlows.battery_to_home + sankeyFlows.grid_to_home;
  } else if (daily.length > 0) {
    gridImport = daily.reduce((s, d) => s + d.total_import_kwh, 0);
    const solar = daily.reduce((s, d) => s + d.solar_generated_kwh, 0);
    const exp = daily.reduce((s, d) => s + d.total_export_kwh, 0);
    totalConsumption = gridImport + solar - exp;
  }
  const selfPoweredPct = totalConsumption > 0
    ? Math.max(0, (1 - gridImport / totalConsumption) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <PeriodSelector
        value={dateRange}
        onChange={handlePeriodChange}
        onModeChange={handleModeChange}
      />

      {/* Swipeable content */}
      <div
        {...swipeHandlers}
        className={`transition-transform duration-300 ease-out ${
          swipeDir === "left"
            ? "-translate-x-2"
            : swipeDir === "right"
              ? "translate-x-2"
              : "translate-x-0"
        }`}
      >
        <div className="space-y-4">
          {/* Self-powered */}
          <SelfPoweredRing selfPoweredPct={selfPoweredPct} />

          {/* Sankey */}
          <SankeyChart
            hourlyData={hourly}
            dailyData={daily}
            days={dateRange.days}
            sankeyFlows={sankeyFlows}
          />

          {/* Mirror chart */}
          <HourlyChart data={hourly} days={dateRange.days} intervalData={intervalData} />

          {/* Alerts */}
          <AlertsList alerts={alerts} />
        </div>
      </div>
    </div>
  );
}
