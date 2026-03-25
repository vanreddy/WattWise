"use client";

import { useState, useCallback } from "react";
import { useSwipeable } from "react-swipeable";
import type { DailySummary, HourlyBucket, SankeyFlows, IntervalPoint, SummaryResponse, CurrentPower } from "@/lib/api";
import type { WeatherData } from "@/hooks/useWeather";
import type { DateRange } from "@/hooks/useDashboardData";
import PeriodSelector, { computeRange, type Mode } from "@/components/PeriodSelector";
import SelfPoweredRing from "@/components/SelfPoweredRing";
import SankeyChart from "@/components/SankeyChart";
import HourlyChart from "@/components/HourlyChart";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { Sun, Cloud, CloudRain, CloudSnow, CloudLightning, CloudDrizzle, Wind } from "lucide-react";

/* ─── Now mode: weather only ─── */

function WeatherIcon({ condition, size = 28 }: { condition: string; size?: number }) {
  if (condition === "thunderstorm") return <CloudLightning size={size} className="text-yellow-400" />;
  if (condition === "rain") return <CloudRain size={size} className="text-blue-400" />;
  if (condition === "snow") return <CloudSnow size={size} className="text-blue-200" />;
  if (condition === "fog") return <Wind size={size} className="text-gray-400" />;
  if (condition === "cloudy") return <Cloud size={size} className="text-gray-400" />;
  if (condition === "partly_cloudy") return <Cloud size={size} className="text-gray-300" />;
  return <Sun size={size} className="text-yellow-400" />;
}

function currentToSankeyFlows(c: CurrentPower): SankeyFlows {
  const solar = Math.max(0, c.solar_w) / 1000;
  const home = Math.max(0, c.home_w) / 1000;
  const gridImport = Math.max(0, c.grid_w) / 1000;
  const gridExport = Math.max(0, -c.grid_w) / 1000;
  const batCharge = Math.max(0, -c.battery_w) / 1000;
  const batDischarge = Math.max(0, c.battery_w) / 1000;
  const ev = Math.max(0, c.vehicle_w) / 1000;

  const solarToHome = Math.min(solar, home);
  const solarToBat = Math.min(solar - solarToHome, batCharge);
  const solarToGrid = Math.min(solar - solarToHome - solarToBat, gridExport);
  const batToHome = Math.min(batDischarge, home - solarToHome);
  const gridToHome = Math.min(gridImport, home + ev - solarToHome - batToHome);
  const gridToBat = Math.min(gridImport - gridToHome, batCharge - solarToBat);

  return {
    solar_to_home: solarToHome,
    solar_to_battery: solarToBat,
    solar_to_grid: solarToGrid,
    battery_to_home: batToHome,
    battery_to_grid: 0,
    grid_to_home: gridToHome,
    grid_to_battery: gridToBat,
  };
}

function NowContent({ weather, lastUpdated, summary }: { weather: WeatherData | null; lastUpdated: Date | null; summary: SummaryResponse | null }) {
  const current = summary?.current;

  // Self-powered % from live data
  const home = current ? Math.max(0, current.home_w) : 0;
  const gridImport = current ? Math.max(0, current.grid_w) : 0;
  const solarDirect = current ? Math.min(Math.max(0, current.solar_w), home) : 0;
  const batDirect = current ? Math.min(Math.max(0, current.battery_w), home - solarDirect) : 0;
  const selfPoweredPct = home > 0 ? Math.round(((home - gridImport) / home) * 100) : 0;
  const solarPct = home > 0 ? Math.round((solarDirect / home) * 100) : 0;
  const batteryPct = home > 0 ? Math.round((batDirect / home) * 100) : 0;

  // Sankey flows from live data
  const liveFlows = current ? currentToSankeyFlows(current) : null;

  // Battery status
  const batteryChargePct = current?.battery_pct ?? 0;
  const batteryW = current?.battery_w ?? 0;
  const isCharging = batteryW < -50;
  const isDischarging = batteryW > 50;
  const batteryStatus = isCharging ? "Charging" : isDischarging ? "Discharging" : "Idle";
  const batteryStatusColor = isCharging ? "text-green-400" : isDischarging ? "text-yellow-400" : "text-gray-500";
  const batteryIcon = isCharging ? "⚡" : isDischarging ? "▼" : "—";

  // Timestamp from the actual data point
  const dataTs = current?.ts ? new Date(current.ts) : null;

  return (
    <div className="space-y-4">
      {/* Weather + data timestamp */}
      <div className="flex items-center justify-between px-1">
        {weather ? (
          <div className="flex items-center gap-2">
            <WeatherIcon condition={weather.condition} size={20} />
            <span className="text-sm text-gray-400">{Math.round(weather.temperature)}°F</span>
            <span className="text-xs text-gray-600 capitalize">{weather.description}</span>
          </div>
        ) : <div />}
        {dataTs && (
          <p className="text-xs text-gray-600">
            Live · {dataTs.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </p>
        )}
      </div>

      {/* Self-Powering Ring */}
      <SelfPoweredRing
        selfPoweredPct={Math.max(0, Math.min(100, selfPoweredPct))}
        solarPct={solarPct}
        batteryPct={batteryPct}
        label="Self-Powering"
      />

      {/* Powerwall Battery Tile */}
      <div className="bg-gray-900/60 border border-gray-800/50 rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-300">Powerwall</p>
            <p className={`text-xs ${batteryStatusColor} flex items-center gap-1`}>
              <span>{batteryIcon}</span> {batteryStatus}
              {(isCharging || isDischarging) && (
                <span className="text-gray-500 ml-1">
                  {(Math.abs(batteryW) / 1000).toFixed(1)} kW
                </span>
              )}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-green-400">{Math.round(batteryChargePct)}%</p>
          </div>
        </div>
        {/* Progress bar */}
        <div className="mt-2 w-full bg-gray-800 rounded-full h-2 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${batteryChargePct}%`,
              background: batteryChargePct > 20 ? "#34d399" : "#f87171",
            }}
          />
        </div>
      </div>

      {/* Live Sankey */}
      {liveFlows && (
        <SankeyChart
          hourlyData={[]}
          dailyData={[]}
          days={0}
          sankeyFlows={liveFlows}
          animated
          liveUnits
          hideBreakdown
        />
      )}
    </div>
  );
}

interface Props {
  daily: DailySummary[];
  hourly: HourlyBucket[];
  intervalData: IntervalPoint[];
  sankeyFlows: SankeyFlows | null;
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  backfillActive: boolean;
  summary: SummaryResponse | null;
  lastUpdated: Date | null;
  error: string | null;
  weather: WeatherData | null;
}

/* ─── Historical mode content ─── */

function BatteryPctChart({ intervalData }: { intervalData: IntervalPoint[] }) {
  if (!intervalData.length) return null;

  const sorted = [...intervalData].sort((a, b) => a.ts.localeCompare(b.ts));

  // Build chart data with same label format as HourlyChart
  const chartData = sorted.map(pt => {
    const d = new Date(pt.ts);
    const h = d.getHours();
    const m = d.getMinutes();
    const h12 = h % 12 || 12;
    const ampm = h < 12 ? "AM" : "PM";
    const label = m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, "0")}`;
    return { label, pct: pt.battery_pct };
  });

  // Same x-axis interval as HourlyChart for alignment
  const xInterval = Math.max(1, Math.floor(chartData.length / 8));

  return (
    <div className="bg-gray-900/60 border border-gray-800/50 rounded-2xl p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Powerwall %</h3>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={chartData} margin={{ top: 10, right: 5, bottom: 0, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="#6b7280"
            fontSize={10}
            interval={xInterval}
            tick={{ dy: 4 }}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            stroke="#6b7280"
            fontSize={10}
            tickFormatter={(v: number) => `${v}%`}
            width={35}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "#9ca3af" }}
            formatter={(value: number) => [`${value.toFixed(0)}%`, "Powerwall"]}
          />
          <defs>
            <linearGradient id="battGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="pct" stroke="#34d399" strokeWidth={2} fill="url(#battGrad)" fillOpacity={0.3} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function SelfPoweredByDayChart({ daily }: { daily: DailySummary[] }) {
  if (daily.length < 2) return null;

  const sorted = [...daily].sort((a, b) => a.day.localeCompare(b.day));
  const maxH = 220;
  const padding = { left: 40, right: 16, top: 16, bottom: 40 };
  const w = 600;
  const chartW = w - padding.left - padding.right;
  const chartH = maxH - padding.top - padding.bottom;
  const barW = Math.min(40, chartW / sorted.length * 0.7);
  const gap = (chartW - barW * sorted.length) / (sorted.length + 1);

  const bars = sorted.map((d, i) => {
    const totalConsumption = d.solar_self_consumed_kwh + d.total_import_kwh;
    const selfPct = totalConsumption > 0 ? (d.solar_self_consumed_kwh / totalConsumption) * 100 : 0;
    // Estimate battery contribution: total self-powered - solar direct
    const totalSelfPowered = totalConsumption > 0 ? ((totalConsumption - d.total_import_kwh) / totalConsumption) * 100 : 0;
    const battPct = Math.max(0, totalSelfPowered - selfPct);
    const x = padding.left + gap + i * (barW + gap);
    const dayLabel = new Date(d.day + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
    return { x, solarPct: selfPct, battPct, totalPct: totalSelfPowered, dayLabel, day: d.day };
  });

  return (
    <div className="bg-gray-900/60 border border-gray-800/50 rounded-2xl p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-1">Self-Powered by Day</h3>
      <div className="flex gap-3 text-[10px] text-gray-500 mb-2">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-yellow-500 inline-block" /> Solar</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-green-500 inline-block" /> Powerwall</span>
      </div>
      <svg viewBox={`0 0 ${w} ${maxH}`} className="w-full" style={{ height: 180 }}>
        {/* Y grid */}
        {[0, 25, 50, 75, 100].map(pct => {
          const y = padding.top + (1 - pct / 100) * chartH;
          return (
            <g key={pct}>
              <line x1={padding.left} x2={w - padding.right} y1={y} y2={y} stroke="#374151" strokeWidth={0.5} />
              <text x={padding.left - 6} y={y + 3} textAnchor="end" className="fill-gray-600" fontSize={9}>{pct}%</text>
            </g>
          );
        })}
        {/* Bars */}
        {bars.map((b, i) => {
          const solarH = (b.solarPct / 100) * chartH;
          const battH = (b.battPct / 100) * chartH;
          const solarY = padding.top + chartH - solarH;
          const battY = solarY - battH;
          return (
            <g key={i}>
              <rect x={b.x} y={solarY} width={barW} height={solarH} rx={3} fill="#eab308" />
              <rect x={b.x} y={battY} width={barW} height={battH} rx={3} fill="#22c55e" />
              <text x={b.x + barW / 2} y={maxH - 18} textAnchor="middle" className="fill-gray-500" fontSize={9}>{b.dayLabel}</text>
              <text x={b.x + barW / 2} y={maxH - 6} textAnchor="middle" className="fill-gray-600" fontSize={8}>
                {Math.round(b.totalPct)}%
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function HistoricalContent({ daily, hourly, intervalData, sankeyFlows, dateRange, swipeDir, mode }: {
  daily: DailySummary[];
  hourly: HourlyBucket[];
  intervalData: IntervalPoint[];
  sankeyFlows: SankeyFlows | null;
  dateRange: DateRange;
  swipeDir: "left" | "right" | null;
  mode: Mode;
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

        {/* Weekly: Self-Powered % by day */}
        {mode === "weekly" && <SelfPoweredByDayChart daily={daily} />}

        <SankeyChart
          hourlyData={hourly}
          dailyData={daily}
          days={dateRange.days}
          sankeyFlows={sankeyFlows}
          animated
        />

        <HourlyChart data={hourly} days={dateRange.days} intervalData={intervalData} />

        {/* Daily: Battery % by hour — below hourly chart, aligned x-axis */}
        {mode === "daily" && <BatteryPctChart intervalData={intervalData} />}
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
      {mode === "now" ? (
        <NowContent weather={weather} lastUpdated={lastUpdated} summary={summary} />
      ) : (
        <div {...swipeHandlers}>
          <HistoricalContent
            daily={daily}
            hourly={hourly}
            intervalData={intervalData}
            sankeyFlows={sankeyFlows}
            dateRange={dateRange}
            swipeDir={swipeDir}
            mode={mode}
          />
        </div>
      )}
    </div>
  );
}
