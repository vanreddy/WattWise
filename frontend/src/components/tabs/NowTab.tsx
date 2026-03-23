"use client";

import type { SummaryResponse } from "@/lib/api";
import type { WeatherData } from "@/hooks/useWeather";
import LiveSankeyChart from "@/components/LiveSankeyChart";
import SelfPoweredRing from "@/components/SelfPoweredRing";
import { Wind, Droplets, Sun, Cloud, CloudRain, CloudSnow, CloudLightning, CloudFog } from "lucide-react";

interface Props {
  summary: SummaryResponse;
  lastUpdated: Date | null;
  error: string | null;
  weather: WeatherData | null;
}

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

export default function NowTab({ summary, lastUpdated, error, weather }: Props) {
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

      {/* Self-Powering Ring */}
      <SelfPoweredRing selfPoweredPct={selfPoweredPct} label="Self-Powering" />

      {/* Live Energy Flow */}
      <LiveSankeyChart current={current} />
    </div>
  );
}
