"use client";

import { useMemo, useEffect, useState } from "react";
import {
  Zap,
  BatteryWarning,
  Sun,
  Car,
  Thermometer,
  TrendingDown,
  Bell,
  BellRing,
  ChevronRight,
  Lightbulb,
  Sparkles,
  CircleAlert,
  Settings,
  Clock,
  WashingMachine,
} from "lucide-react";
import type { SummaryResponse, DailySummary, Alert } from "@/lib/api";
import type { AuthUser } from "@/lib/auth";
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
  user: AuthUser | null;
}

/* ─── Strategic rules-based recommendations ─── */

function generateRulesBasedSuggestions(
  daily: DailySummary[],
  user: AuthUser | null,
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const last7 = daily.slice(0, 7);

  // Compute average daily export across recent days
  const daysWithSolar = last7.filter((d) => d.solar_generated_kwh > 5);
  const avgExportKwh =
    daysWithSolar.length > 0
      ? daysWithSolar.reduce((s, d) => s + d.total_export_kwh, 0) / daysWithSolar.length
      : 0;
  const isHighExporter = avgExportKwh > 5; // exporting 5+ kWh/day on average

  // 1. NEM 3.0 high exporter + no Telegram alerts → suggest enabling alerts
  if (isHighExporter && user && !user.telegram_chat_id) {
    suggestions.push({
      id: "enable-alerts",
      icon: <BellRing size={20} />,
      iconBg: "bg-yellow-500/20 text-yellow-400",
      title: "Enable real-time solar alerts",
      description:
        "You're on NEM 3.0 where grid export earns only $0.07/kWh — but that same energy used at home offsets $0.32/kWh. Link Telegram in Settings to get notified when you have excess solar, so you can shift loads and capture 5× more value.",
      savings: `~$${(avgExportKwh * 0.25 * 30).toFixed(0)}/mo opportunity`,
      priority: "high",
    });
  }

  // 2. NEM 3.0 high exporter → shift EV charging to solar hours (morning)
  if (isHighExporter) {
    const evDays = last7.filter((d) => d.ev_kwh > 2);
    const evOffPeakHeavy = evDays.filter(
      (d) => d.ev_off_peak_kwh > d.ev_kwh * 0.6,
    );
    // If EV charges mostly off-peak (overnight), suggest switching to morning solar
    if (evOffPeakHeavy.length >= 2) {
      const avgEvKwh = evDays.reduce((s, d) => s + d.ev_kwh, 0) / evDays.length;
      const savedPerCharge = avgEvKwh * 0.319; // off-peak rate they're paying
      suggestions.push({
        id: "ev-solar-charging",
        icon: <Car size={20} />,
        iconBg: "bg-purple-500/20 text-purple-400",
        title: "Charge your EV during solar hours",
        description:
          `Your EV appears to charge overnight at off-peak rates ($0.319/kWh). On NEM 3.0, charging during solar hours (9 AM–3 PM) uses free solar instead — saving ~$${savedPerCharge.toFixed(2)} per charge session. Set your Tesla to start charging at 9 AM.`,
        savings: `~$${(savedPerCharge * 15).toFixed(0)}/mo savings`,
        priority: "high",
      });
    }
  }

  // 3. NEM 3.0 high exporter → run dishwasher/laundry during solar, not overnight
  if (isHighExporter && avgExportKwh > 8) {
    suggestions.push({
      id: "shift-loads-solar",
      icon: <WashingMachine size={20} />,
      iconBg: "bg-blue-500/20 text-blue-400",
      title: "Run appliances during solar hours",
      description:
        `You're exporting ${avgExportKwh.toFixed(0)} kWh/day to the grid at $0.07/kWh. Running your dishwasher, laundry, and dryer between 9 AM–3 PM uses free solar instead of overnight grid power at $0.319/kWh. That's a 5× difference in value per kWh.`,
      savings: null,
      priority: "medium",
    });
  }

  // 4. Powerwall not in self-powered mode heuristic:
  //    If battery coverage is consistently low but battery isn't depleting
  //    (i.e., battery isn't being used during peak), it may not be set to self-powered
  if (last7.length >= 3) {
    const daysLowCoverage = last7.filter(
      (d) =>
        (d.battery_peak_coverage_pct ?? 0) < 30 &&
        d.battery_depletion_hour === null &&
        d.peak_import_kwh > 2,
    );
    if (daysLowCoverage.length >= 3) {
      suggestions.push({
        id: "powerwall-self-powered",
        icon: <Settings size={20} />,
        iconBg: "bg-emerald-500/20 text-emerald-400",
        title: "Set Powerwall to Self-Powered mode",
        description:
          `Your Powerwall covered less than 30% of peak hours on ${daysLowCoverage.length} of the last ${last7.length} days, while you imported ${(daysLowCoverage.reduce((s, d) => s + d.peak_import_kwh, 0) / daysLowCoverage.length).toFixed(1)} kWh/day during peak. In the Tesla app, set your Powerwall to "Self-Powered" mode so it prioritizes powering your home during expensive peak hours.`,
        savings: null,
        priority: "high",
      });
    }
  }

  return suggestions;
}

/* ─── Real-time + single-day AI suggestions ─── */

function generateRealtimeSuggestions(
  summary: SummaryResponse | null,
  daily: DailySummary[],
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const recent = daily.length > 0 ? daily[0] : null;

  // Solar surplus — exporting right now
  if (summary && summary.current.grid_w < -2000) {
    const exportKw = Math.abs(summary.current.grid_w / 1000);
    suggestions.push({
      id: "solar-surplus",
      icon: <Sun size={20} />,
      iconBg: "bg-yellow-500/20 text-yellow-400",
      title: "Use your solar surplus",
      description: `You're exporting ${exportKw.toFixed(1)} kW to the grid at ~$0.07/kWh. That same energy powers your home at $0.32/kWh — nearly 5× more valuable. Good time to run the dishwasher, laundry, or charge your EV.`,
      savings: `$${(exportKw * 0.25).toFixed(2)}/hr potential`,
      priority: "high",
    });
  }

  // Pre-cool suggestion (high home draw)
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

  // EV charging during peak yesterday
  if (recent && recent.ev_peak_kwh > 0.5) {
    const peakCost = recent.ev_peak_kwh * 0.356;
    const offPeakCost = recent.ev_peak_kwh * 0.319;
    suggestions.push({
      id: "ev-off-peak",
      icon: <Clock size={20} />,
      iconBg: "bg-purple-500/20 text-purple-400",
      title: "EV charged during peak yesterday",
      description: `You charged ${recent.ev_peak_kwh.toFixed(1)} kWh during peak hours at $0.356/kWh. Scheduling charging for solar hours (9 AM–3 PM) uses free solar, or after 9 PM for off-peak rates.`,
      savings: `$${(peakCost - offPeakCost).toFixed(2)}/day savings`,
      priority: "high",
    });
  }

  // Battery depleted too early yesterday
  if (recent && recent.battery_depletion_hour !== null && recent.battery_depletion_hour < 21) {
    const hour = recent.battery_depletion_hour;
    const formatted = hour >= 12 ? `${hour === 12 ? 12 : hour - 12} PM` : `${hour} AM`;
    suggestions.push({
      id: "battery-depletion",
      icon: <BatteryWarning size={20} />,
      iconBg: "bg-emerald-500/20 text-emerald-400",
      title: "Powerwall ran out early yesterday",
      description: `Your Powerwall depleted at ${formatted} — before the evening peak ended at 9 PM. Consider reserving 15-20% for peak hours, or reducing mid-day export to keep more stored energy.`,
      savings: null,
      priority: "medium",
    });
  }

  // Low self-consumption yesterday
  if (recent && recent.solar_generated_kwh > 10) {
    const selfRatio = recent.solar_self_consumed_kwh / recent.solar_generated_kwh;
    if (selfRatio < 0.5) {
      const wastedValue = (recent.solar_generated_kwh - recent.solar_self_consumed_kwh) * (0.32 - 0.07);
      suggestions.push({
        id: "self-consumption",
        icon: <TrendingDown size={20} />,
        iconBg: "bg-orange-500/20 text-orange-400",
        title: "Low solar self-consumption yesterday",
        description: `Only ${(selfRatio * 100).toFixed(0)}% of your solar was used at home. The rest was exported at $0.07/kWh instead of offsetting $0.32/kWh grid power. Shifting loads to midday could capture more value.`,
        savings: `$${wastedValue.toFixed(2)}/day opportunity`,
        priority: "medium",
      });
    }
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

/* ─── Suggestion card ───────────────────────── */

function SuggestionCard({ s }: { s: Suggestion }) {
  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 hover:border-gray-700 transition-colors">
      <div className="flex items-start gap-3">
        <div className={`rounded-lg p-2 shrink-0 ${s.iconBg}`}>
          {s.icon}
        </div>
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
            <div className="mt-2">
              <span className="text-xs font-semibold text-emerald-400">
                {s.savings}
              </span>
            </div>
          )}
        </div>
        <ChevronRight size={16} className="text-gray-600 shrink-0 mt-0.5" />
      </div>
    </div>
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

/* ─── Sticky suggestions (persist for 7 days) ─ */

const STICKY_KEY = "selfpower_suggestions";
const STICKY_DAYS = 7;

interface StickyEntry {
  suggestion: Suggestion;
  firstSeen: number; // epoch ms
}

function useStickysuggestions(current: Suggestion[]): Suggestion[] {
  const [sticky, setSticky] = useState<StickyEntry[]>([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STICKY_KEY) || "[]") as StickyEntry[];
      setSticky(stored);
    } catch { /* ignore */ }
  }, []);

  return useMemo(() => {
    const now = Date.now();
    const cutoff = now - STICKY_DAYS * 24 * 60 * 60 * 1000;
    const currentIds = new Set(current.map(s => s.id));

    // Merge: current suggestions + stored ones still within 7 days
    const merged = new Map<string, StickyEntry>();

    // Add stored entries that are still within 7 days
    for (const entry of sticky) {
      if (entry.firstSeen > cutoff) {
        merged.set(entry.suggestion.id, entry);
      }
    }

    // Add/update current suggestions
    for (const s of current) {
      if (!merged.has(s.id)) {
        merged.set(s.id, { suggestion: s, firstSeen: now });
      } else {
        // Update suggestion content but keep firstSeen
        const existing = merged.get(s.id)!;
        merged.set(s.id, { ...existing, suggestion: s });
      }
    }

    // Persist to localStorage
    const entries = [...merged.values()];
    try {
      localStorage.setItem(STICKY_KEY, JSON.stringify(entries));
    } catch { /* ignore */ }

    return entries.map(e => e.suggestion);
  }, [current, sticky]);
}

/* ─── Component ─────────────────────────────── */

export default function OptimizeTab({ summary, daily, alerts, user }: Props) {
  const rawRulesSuggestions = generateRulesBasedSuggestions(daily, user);
  const rulesSuggestions = useStickysuggestions(rawRulesSuggestions);
  const realtimeSuggestions = generateRealtimeSuggestions(summary, daily);

  // Most recent daily summary with AI narrative
  const latest = daily.length > 0 ? daily[0] : null;
  const narrative = latest?.context_narrative;
  const backendActions = latest?.actions ?? [];

  const hasNoSuggestions = rulesSuggestions.length === 0 && realtimeSuggestions.length === 0;

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

      {/* ── Rules-based recommendations ── */}
      {rulesSuggestions.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-1.5">
            <Lightbulb size={14} className="text-yellow-400" />
            Recommendations
          </h2>
          <div className="space-y-3">
            {rulesSuggestions.map((s) => (
              <SuggestionCard key={s.id} s={s} />
            ))}
          </div>
        </section>
      )}

      {/* ── Real-time suggestions ── */}
      {realtimeSuggestions.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-1.5">
            <Zap size={14} className="text-yellow-400" />
            Right Now
          </h2>
          <div className="space-y-3">
            {realtimeSuggestions.map((s) => (
              <SuggestionCard key={s.id} s={s} />
            ))}
          </div>
        </section>
      )}

      {/* ── No suggestions fallback ── */}
      {hasNoSuggestions && (
        <section>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 text-center">
            <Lightbulb size={24} className="text-yellow-400/60 mx-auto mb-2" />
            <p className="text-sm text-gray-400">
              No recommendations right now. Your system is running efficiently.
            </p>
          </div>
        </section>
      )}

      {/* ── Alerts ── */}
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
