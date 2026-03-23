"use client";

import { useState, useCallback } from "react";
import { useSwipeable } from "react-swipeable";
import type { DailySummary, HourlyBucket, SankeyFlows, IntervalPoint, SummaryResponse } from "@/lib/api";
import type { WeatherData } from "@/hooks/useWeather";
import type { DateRange } from "@/hooks/useDashboardData";
import PeriodSelector, { computeRange, type Mode } from "@/components/PeriodSelector";
import SelfPoweredRing from "@/components/SelfPoweredRing";
import SankeyChart from "@/components/SankeyChart";
import HourlyChart from "@/components/HourlyChart";
import { Wind, Droplets, Sun, Cloud, CloudRain, CloudSnow, CloudLightning, CloudFog } from "lucide-react";

interface Props {
  daily: DailySummary[];
  hourly: HourlyBucket[];
  intervalData: IntervalPoint[];
  sankeyFlows: SankeyFlows | null;
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  backfillActive: boolean;
  // Live data for "now" mode
  summary: SummaryResponse | null;
  lastUpdated: Date | null;
  error: string | null;
  weather: WeatherData | null;
}

/* ─── Weather components (from NowTab) ─── */

function WeatherIcon({ condition }: { condition: string }) {
  const cls = "w-5 h-5";
  switch (condition) {
    case "clear": return <Sun className={`${cls} text-yellow-400`} />;
    case "partly_cloudy": return <Cloud className={`${cls} text-gray-400`} />;
    case "cloudy": return <Cloud className={`${cls} text-gray-500`} />;
    case "fog": return <CloudFog className={`${cls} text-gray-500`} />;
    case "rain": return <CloudRain className={`${cls} text-blue-400`} />;
    case "snow": return <CloudSnow className={`${cls} text-blue-200`} />;
    case "thunderstorm": return <CloudLightning className={`${cls} text-yellow-300`} />;
    default: return <Sun className={`${cls} text-yellow-400`} />;
  }
}

function WeatherBar({ weather }: { weather: WeatherData }) {
  return (
    <div className="bg-gray-900 rounded-xl px-4 py-3 border border-gray-800 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <WeatherIcon condition={weather.condition} />
        <span className="text-xl font-semibold text-white">{weather.temperature}°F</span>
        <span className="text-sm text-gray-400">{weather.description}</span>
      </div>
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <Wind size={12} />
          {weather.windSpeed} mph
        </span>
        <span className="flex items-center gap-1">
          <Droplets size={12} />
          {weather.humidity}%
        </span>
      </div>
    </div>
  );
}

/* ─── Now mode content ─── */

function NowContent({ summary, lastUpdated, error, weather, hourly, daily, sankeyFlows, dateRange }: {
  summary: SummaryResponse;
  lastUpdated: Date | null;
  error: string | null;
  weather: WeatherData | null;
  hourly: HourlyBucket[];
  daily: DailySummary[];
  sankeyFlows: SankeyFlows | null;
  dateRange: DateRange;
}) {
  const current = summary.current;
  const home = Math.max(0, current.home_w);
  const gridImport = Math.max(0, current.grid_w);
  const selfPoweredPct = home > 0
    ? Math.round(Math.max(0, Math.min(100, ((home - gridImport) / home) * 100)))
    : 100;

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex justify-between items-center text-xs text-gray-500">
        <span>
          {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : ""}
        </span>
        {error && <span className="text-yellow-500">Refresh failed</span>}
      </div>

      {/* Weather */}
      {weather && <WeatherBar weather={weather} />}

      {/* Self-Powering Ring with live indicator */}
      <SelfPoweredRing selfPoweredPct={selfPoweredPct} label="Self-Powering" live />

      {/* Sankey — same as Today but with flowing animation */}
      <SankeyChart
        hourlyData={hourly}
        dailyData={daily}
        days={dateRange.days}
        sankeyFlows={sankeyFlows}
        animated
      />
    </div>
  );
}

/* ─── Historical mode content ─── */

function HistoricalContent({ daily, hourly, intervalData, sankeyFlows, dateRange, swipeDir }: {
  daily: DailySummary[];
  hourly: HourlyBucket[];
  intervalData: IntervalPoint[];
  sankeyFlows: SankeyFlows | null;
  dateRange: DateRange;
  swipeDir: "left" | "right" | null;
}) {
  // Compute self-powered % with solar/battery breakout
  let gridImport = 0;
  let totalConsumption = 0;
  let solarToHome = 0;
  let batteryToHome = 0;
  if (sankeyFlows) {
    gridImport = sankeyFlows.grid_to_home + sankeyFlows.grid_to_battery;
    solarToHome = sankeyFlows.solar_to_home;
    batteryToHome = sankeyFlows.battery_to_home;
    totalConsumption = solarToHome + batteryToHome + sankeyFlows.grid_to_home;
  } else if (daily.length > 0) {
    gridImport = daily.reduce((s, d) => s + d.total_import_kwh, 0);
    const solar = daily.reduce((s, d) => s + d.solar_generated_kwh, 0);
    const exp = daily.reduce((s, d) => s + d.total_export_kwh, 0);
    totalConsumption = gridImport + solar - exp;
    solarToHome = daily.reduce((s, d) => s + d.solar_self_consumed_kwh, 0);
    batteryToHome = Math.max(0, totalConsumption - solarToHome - gridImport);
  }
  const selfPoweredPct = totalConsumption > 0
    ? Math.max(0, (1 - gridImport / totalConsumption) * 100)
    : 0;
  const solarPct = totalConsumption > 0 ? (solarToHome / totalConsumption) * 100 : 0;
  const batteryPctVal = totalConsumption > 0 ? (batteryToHome / totalConsumption) * 100 : 0;

  return (
    <div
      className={`transition-transform duration-300 ease-out ${
        swipeDir === "left"
          ? "-translate-x-2"
          : swipeDir === "right"
            ? "translate-x-2"
            : "translate-x-0"
      }`}
    >
      <div className="space-y-4">
        <SelfPoweredRing selfPoweredPct={selfPoweredPct} solarPct={solarPct} batteryPct={batteryPctVal} />

        <SankeyChart
          hourlyData={hourly}
          dailyData={daily}
          days={dateRange.days}
          sankeyFlows={sankeyFlows}
        />

        <HourlyChart data={hourly} days={dateRange.days} intervalData={intervalData} />
      </div>
    </div>
  );
}

/* ─── Main FlowTab ─── */

export default function FlowTab({
  daily,
  hourly,
  intervalData,
  sankeyFlows,
  dateRange,
  setDateRange,
  backfillActive,
  summary,
  lastUpdated,
  error,
  weather,
}: Props) {
  const [mode, setMode] = useState<Mode>("daily");
  const [offset, setOffset] = useState(0);
  const [swipeDir, setSwipeDir] = useState<"left" | "right" | null>(null);

  const navigate = useCallback(
    (dir: -1 | 1) => {
      if (mode === "now") return;
      const newOffset = offset + dir;
      if (newOffset > 0) return;
      setOffset(newOffset);
      setSwipeDir(dir === -1 ? "right" : "left");
      const range = computeRange(mode, newOffset);
      setDateRange(range);
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

  const isNow = mode === "now";

  return (
    <div className="space-y-4">
      {/* Period selector — sticky */}
      <div className="sticky top-0 z-20 bg-gray-950 pb-2 -mx-3 px-3 sm:-mx-4 sm:px-4">
        <PeriodSelector
          value={dateRange}
          onChange={handlePeriodChange}
          onModeChange={handleModeChange}
          modes={["now", "daily", "weekly", "monthly", "yearly"]}
          defaultMode="daily"
        />
      </div>

      {/* Content */}
      {isNow && summary ? (
        <NowContent
          summary={summary}
          lastUpdated={lastUpdated}
          error={error}
          weather={weather}
          hourly={hourly}
          daily={daily}
          sankeyFlows={sankeyFlows}
          dateRange={dateRange}
        />
      ) : (
        <div {...swipeHandlers}>
          <HistoricalContent
            daily={daily}
            hourly={hourly}
            intervalData={intervalData}
            sankeyFlows={sankeyFlows}
            dateRange={dateRange}
            swipeDir={swipeDir}
          />
        </div>
      )}
    </div>
  );
}
