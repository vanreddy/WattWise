"use client";

import {
  Zap,
  BatteryWarning,
  Sun,
  Car,
  Thermometer,
  TrendingDown,
  Bell,
  ChevronRight,
  Lightbulb,
  Sparkles,
  CircleAlert,
} from "lucide-react";
import type { SummaryResponse, DailySummary, Alert } from "@/lib/api";
import type { ReactNode } from "react";

/* ─── Types ─────────────────────────────────── */

interface Suggestion {
  id: string;
  icon: ReactNode;
  iconBg: string;
  title: string;
  description: string;
  savings: string | null;
  priority: "high" | "medium" | "low";
}

interface Props {
  summary: SummaryResponse | null;
  daily: DailySummary[];
  alerts: Alert[];
}

/* ─── Suggestion engine ─────────────────────── */

function generateSuggestions(
  summary: SummaryResponse | null,
  daily: DailySummary[],
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const recent = daily.length > 0 ? daily[0] : null;

  // 1. Solar surplus — you're exporting right now
  if (summary && summary.current.grid_w < -2000) {
    const exportKw = Math.abs(summary.current.grid_w / 1000);
    suggestions.push({
      id: "solar-surplus",
      icon: <Sun size={20} />,
      iconBg: "bg-yellow-500/20 text-yellow-400",
      title: "Use your solar surplus",
      description: `You're exporting ${exportKw.toFixed(1)} kW to the grid at ~$0.07/kWh. That same energy powers your home at $0.32/kWh — nearly 5× more valuable. Good time to run the dishwasher, laundry, or charge your EV.`,
      savings: `$${((exportKw * 0.25) ).toFixed(2)}/hr potential`,
      priority: "high",
    });
  }

  // 2. EV charging during peak
  if (recent && recent.ev_peak_kwh > 0.5) {
    const peakCost = recent.ev_peak_kwh * 0.356;
    const offPeakCost = recent.ev_peak_kwh * 0.319;
    suggestions.push({
      id: "ev-off-peak",
      icon: <Car size={20} />,
      iconBg: "bg-purple-500/20 text-purple-400",
      title: "Shift EV charging to off-peak",
      description: `Yesterday you charged ${recent.ev_peak_kwh.toFixed(1)} kWh during peak hours at $0.356/kWh. Scheduling charging after 9 PM (off-peak at $0.319/kWh) would save money every session.`,
      savings: `$${(peakCost - offPeakCost).toFixed(2)}/day savings`,
      priority: "high",
    });
  }

  // 3. Battery depleted too early
  if (recent && recent.battery_depletion_hour !== null && recent.battery_depletion_hour < 21) {
    const hour = recent.battery_depletion_hour;
    const formatted = hour >= 12 ? `${hour === 12 ? 12 : hour - 12} PM` : `${hour} AM`;
    suggestions.push({
      id: "battery-depletion",
      icon: <BatteryWarning size={20} />,
      iconBg: "bg-emerald-500/20 text-emerald-400",
      title: "Powerwall running out too early",
      description: `Your battery depleted at ${formatted} yesterday — before the evening peak ended at 9 PM. Consider reserving 15-20% battery for peak hours, or reducing mid-day export to keep more stored energy.`,
      savings: null,
      priority: "medium",
    });
  }

  // 4. Low self-consumption ratio
  if (recent && recent.solar_generated_kwh > 10) {
    const selfRatio = recent.solar_self_consumed_kwh / recent.solar_generated_kwh;
    if (selfRatio < 0.5) {
      const wastedValue = (recent.solar_generated_kwh - recent.solar_self_consumed_kwh) * (0.32 - 0.07);
      suggestions.push({
        id: "self-consumption",
        icon: <TrendingDown size={20} />,
        iconBg: "bg-orange-500/20 text-orange-400",
        title: "Increase solar self-consumption",
        description: `Only ${(selfRatio * 100).toFixed(0)}% of your solar was used at home yesterday. The rest was exported at $0.07/kWh instead of offsetting $0.32/kWh grid power. Shifting loads to midday could capture more value.`,
        savings: `$${wastedValue.toFixed(2)}/day opportunity`,
        priority: "medium",
      });
    }
  }

  // 5. Pre-cool suggestion (hot day heuristic)
  if (summary && summary.current.home_w > 3000) {
    suggestions.push({
      id: "pre-cool",
      icon: <Thermometer size={20} />,
      iconBg: "bg-blue-500/20 text-blue-400",
      title: "Pre-cool before peak pricing",
      description: "Your home draw is high — likely running AC. On hot days, pre-cooling to 72°F by 3 PM lets you raise the thermostat during peak hours (4-9 PM) when electricity costs 12% more.",
      savings: null,
      priority: "low",
    });
  }

  // If no data-driven suggestions, show a general tip
  if (suggestions.length === 0) {
    suggestions.push({
      id: "general-tip",
      icon: <Lightbulb size={20} />,
      iconBg: "bg-yellow-500/20 text-yellow-400",
      title: "You're doing great",
      description: "No urgent optimizations right now. Your system is running efficiently. We'll surface suggestions here when we spot opportunities to save.",
      savings: null,
      priority: "low",
    });
  }

  return suggestions;
}

/* ─── Priority badge ────────────────────────── */

function PriorityBadge({ priority }: { priority: Suggestion["priority"] }) {
  const styles = {
    high: "bg-red-500/15 text-red-400 border-red-500/30",
    medium: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    low: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  };
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${styles[priority]}`}>
      {priority}
    </span>
  );
}

/* ─── Alert helpers ─────────────────────────── */

function alertColor(type: string) {
  if (type.includes("surplus")) return "border-yellow-500 bg-yellow-500/5";
  if (type.includes("peak") || type.includes("cost")) return "border-red-500 bg-red-500/5";
  if (type.includes("battery")) return "border-emerald-500 bg-emerald-500/5";
  return "border-blue-500 bg-blue-500/5";
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ─── Component ─────────────────────────────── */

export default function OptimizeTab({ summary, daily, alerts }: Props) {
  const suggestions = generateSuggestions(summary, daily);

  // Most recent daily summary with AI narrative
  const latest = daily.length > 0 ? daily[0] : null;
  const narrative = latest?.context_narrative;
  const backendActions = latest?.actions ?? [];

  return (
    <div className="space-y-6">
      {/* ── AI Daily Insight ── */}
      {narrative && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-1.5">
            <Sparkles size={14} className="text-purple-400" />
            Daily Insight
          </h2>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <p className="text-sm text-gray-300 leading-relaxed">
              {narrative}
            </p>
            {backendActions.length > 0 && (
              <div className="mt-3 space-y-2">
                {backendActions.map((action, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <CircleAlert size={14} className="text-yellow-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-gray-400 leading-relaxed">{action}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Section 1: Suggested Actions ── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-1.5">
          <Zap size={14} className="text-yellow-400" />
          Suggested Actions
        </h2>
        <div className="space-y-3">
          {suggestions.map((s) => (
            <div
              key={s.id}
              className="bg-gray-900 rounded-xl p-4 border border-gray-800 hover:border-gray-700 transition-colors"
            >
              <div className="flex items-start gap-3">
                {/* Icon */}
                <div className={`rounded-lg p-2 shrink-0 ${s.iconBg}`}>
                  {s.icon}
                </div>
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h3 className="text-sm font-semibold text-gray-200">
                      {s.title}
                    </h3>
                    <PriorityBadge priority={s.priority} />
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    {s.description}
                  </p>
                  {s.savings && (
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-emerald-400">
                        {s.savings}
                      </span>
                    </div>
                  )}
                </div>
                {/* Chevron */}
                <ChevronRight size={16} className="text-gray-600 shrink-0 mt-0.5" />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section 2: Alerts ── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-1.5">
          <Bell size={14} className="text-yellow-400" />
          Recent Alerts
        </h2>
        {alerts.length === 0 ? (
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <p className="text-sm text-gray-500">No recent alerts</p>
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.slice(0, 8).map((alert) => (
              <div
                key={alert.id}
                className={`rounded-xl p-3 border-l-2 ${alertColor(alert.alert_type)}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-gray-300 leading-relaxed flex-1">
                    {alert.message}
                  </p>
                  <span className="text-[10px] text-gray-500 whitespace-nowrap shrink-0">
                    {timeAgo(alert.fired_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
