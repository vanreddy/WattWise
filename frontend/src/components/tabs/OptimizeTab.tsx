"use client";

import { useMemo } from "react";
import {
  Zap,
  BatteryWarning,
  Sun,
  Car,
  Thermometer,
  TrendingDown,
  Lightbulb,
  Sparkles,
  CircleAlert,
  Clock,
  WashingMachine,
  Settings,
} from "lucide-react";
import type { ReactNode } from "react";
import type { SummaryResponse, DailySummary, Alert } from "@/lib/api";
import HealthReportSection from "@/components/HealthReportSection";

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

/* ─── Real-time suggestions ──────────────────── */

function realtimeSuggestions(summary: SummaryResponse | null, daily: DailySummary[]): Suggestion[] {
  const out: Suggestion[] = [];
  const today = daily[0] ?? null;

  if (summary && summary.current.grid_w < -2000) {
    const kw = Math.abs(summary.current.grid_w / 1000);
    out.push({
      id: "solar-surplus",
      icon: <Sun size={20} />,
      iconBg: "bg-yellow-500/20 text-yellow-400",
      title: "Use your solar surplus",
      description: `You're exporting ${kw.toFixed(1)} kW to the grid at ~$0.07/kWh. That same energy powers your home at $0.32/kWh — 5× more valuable. Good time to run the dishwasher, laundry, or charge the EV.`,
      savings: `$${(kw * 0.25).toFixed(2)}/hr potential`,
      priority: "high",
    });
  }

  if (summary && summary.current.home_w > 3000) {
    out.push({
      id: "pre-cool",
      icon: <Thermometer size={20} />,
      iconBg: "bg-blue-500/20 text-blue-400",
      title: "Pre-cool before peak pricing",
      description: "Your home draw is high — likely running AC. Pre-cooling to 72°F by 3 PM lets you raise the thermostat during peak hours (4–9 PM) when electricity costs more.",
      savings: null,
      priority: "low",
    });
  }

  if (today && today.ev_peak_kwh > 0.5) {
    out.push({
      id: "ev-off-peak",
      icon: <Clock size={20} />,
      iconBg: "bg-purple-500/20 text-purple-400",
      title: "EV charged during peak yesterday",
      description: `You charged ${today.ev_peak_kwh.toFixed(1)} kWh during peak hours at $0.356/kWh. Scheduling for solar hours (10 am–2 pm) uses free solar instead.`,
      savings: `$${(today.ev_peak_kwh * (0.356 - 0.319)).toFixed(2)}/day savings`,
      priority: "high",
    });
  }

  if (today && today.battery_depletion_hour !== null && today.battery_depletion_hour < 21) {
    const h = today.battery_depletion_hour;
    const fmt = h >= 12 ? `${h === 12 ? 12 : h - 12} PM` : `${h} AM`;
    out.push({
      id: "battery-depletion",
      icon: <BatteryWarning size={20} />,
      iconBg: "bg-emerald-500/20 text-emerald-400",
      title: "Powerwall ran out early yesterday",
      description: `Your Powerwall depleted at ${fmt} — before the 9 PM peak end. Consider lowering the reserve to 10% to extend dispatch capacity through the full evening window.`,
      savings: null,
      priority: "medium",
    });
  }

  if (today && today.solar_generated_kwh > 10) {
    const ratio = today.solar_self_consumed_kwh / today.solar_generated_kwh;
    if (ratio < 0.5) {
      const wasted = (today.solar_generated_kwh - today.solar_self_consumed_kwh) * (0.32 - 0.07);
      out.push({
        id: "self-consumption",
        icon: <TrendingDown size={20} />,
        iconBg: "bg-orange-500/20 text-orange-400",
        title: "Low solar self-consumption yesterday",
        description: `Only ${(ratio * 100).toFixed(0)}% of solar was used at home. Shifting loads to midday could capture the rest instead of exporting at $0.07/kWh.`,
        savings: `$${wasted.toFixed(2)}/day opportunity`,
        priority: "medium",
      });
    }
  }

  return out;
}

/* ─── 7-day rules-based recommendations ──────── */

function rulesSuggestions(daily: DailySummary[]): Suggestion[] {
  const out: Suggestion[] = [];
  const last7 = daily.slice(0, 7);
  if (last7.length === 0) return out;

  const solarDays = last7.filter(d => d.solar_generated_kwh > 5);
  const avgExport = solarDays.length > 0
    ? solarDays.reduce((s, d) => s + d.total_export_kwh, 0) / solarDays.length
    : 0;
  const highExporter = avgExport > 5;

  if (highExporter) {
    const evDays = last7.filter(d => d.ev_kwh > 2);
    const offPeakHeavy = evDays.filter(d => d.ev_off_peak_kwh > d.ev_kwh * 0.6);
    if (offPeakHeavy.length >= 2) {
      const avg = evDays.reduce((s, d) => s + d.ev_kwh, 0) / evDays.length;
      out.push({
        id: "ev-solar-charging",
        icon: <Car size={20} />,
        iconBg: "bg-purple-500/20 text-purple-400",
        title: "Charge your EV during solar hours",
        description: `Your EV is charging overnight at off-peak rates ($0.319/kWh). On NEM 3.0, charging during solar hours (10 am–2 pm) uses free solar instead — saving ~$${(avg * 0.25).toFixed(2)} per session. Set your Tesla departure time to 9 am.`,
        savings: `~$${(avg * 0.25 * 15).toFixed(0)}/mo savings`,
        priority: "high",
      });
    }
  }

  if (highExporter && avgExport > 8) {
    out.push({
      id: "shift-loads-solar",
      icon: <WashingMachine size={20} />,
      iconBg: "bg-blue-500/20 text-blue-400",
      title: "Run appliances during solar hours",
      description: `You're exporting ${avgExport.toFixed(0)} kWh/day at $0.07/kWh. Running your dishwasher, laundry, and dryer at 10 am uses free solar instead of overnight grid power at $0.319/kWh — a 5× difference.`,
      savings: null,
      priority: "medium",
    });
  }

  if (last7.length >= 3) {
    const lowCoverage = last7.filter(
      d => (d.battery_peak_coverage_pct ?? 0) < 30 && d.battery_depletion_hour === null && d.peak_import_kwh > 2
    );
    if (lowCoverage.length >= 3) {
      const avgPeak = lowCoverage.reduce((s, d) => s + d.peak_import_kwh, 0) / lowCoverage.length;
      out.push({
        id: "powerwall-self-powered",
        icon: <Settings size={20} />,
        iconBg: "bg-emerald-500/20 text-emerald-400",
        title: "Set Powerwall to Self-Powered mode",
        description: `Powerwall covered less than 30% of peak hours on ${lowCoverage.length} of the last ${last7.length} days, while importing ${avgPeak.toFixed(1)} kWh/day during peak. In the Tesla app, set your Powerwall to "Self-Powered" mode.`,
        savings: null,
        priority: "high",
      });
    }
  }

  return out;
}

/* ─── Shared UI pieces ───────────────────────── */

function PriorityBadge({ priority }: { priority: Suggestion["priority"] }) {
  const styles = {
    high:   "bg-red-500/15 text-red-400 border-red-500/30",
    medium: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    low:    "bg-gray-500/15 text-gray-400 border-gray-500/30",
  };
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${styles[priority]}`}>
      {priority}
    </span>
  );
}

function SuggestionCard({ s }: { s: Suggestion }) {
  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 hover:border-gray-700 transition-colors">
      <div className="flex items-start gap-3">
        <div className={`rounded-lg p-2 shrink-0 ${s.iconBg}`}>{s.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="text-sm font-semibold text-gray-200">{s.title}</h3>
            <PriorityBadge priority={s.priority} />
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">{s.description}</p>
          {s.savings && (
            <p className="text-xs font-semibold text-emerald-400 mt-2">{s.savings}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Tab ────────────────────────────────────── */

export default function OptimizeTab({ summary, daily, alerts: _alerts }: Props) {
  const realtime  = useMemo(() => realtimeSuggestions(summary, daily), [summary, daily]);
  const strategic = useMemo(() => rulesSuggestions(daily), [daily]);

  const latest       = daily[0] ?? null;
  const narrative    = latest?.context_narrative;
  const backendActions = latest?.actions ?? [];

  return (
    <div className="space-y-6">

      {/* ── Health Report (onboarding + weekly) ── */}
      <HealthReportSection />

      {/* ── Right Now ── */}
      {realtime.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-1.5">
            <Zap size={14} className="text-yellow-400" />
            Right Now
          </h2>
          <div className="space-y-3">
            {realtime.map(s => <SuggestionCard key={s.id} s={s} />)}
          </div>
        </section>
      )}

      {/* ── AI Daily Insight ── */}
      {narrative && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-1.5">
            <Sparkles size={14} className="text-purple-400" />
            Daily Insight
          </h2>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <p className="text-sm text-gray-300 leading-relaxed">{narrative}</p>
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

      {/* ── 7-day Recommendations ── */}
      {strategic.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-1.5">
            <Lightbulb size={14} className="text-yellow-400" />
            Recommendations
          </h2>
          <div className="space-y-3">
            {strategic.map(s => <SuggestionCard key={s.id} s={s} />)}
          </div>
        </section>
      )}

      {/* ── Empty state ── */}
      {realtime.length === 0 && strategic.length === 0 && !narrative && (
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 text-center">
          <Lightbulb size={24} className="text-yellow-400/60 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No recommendations right now.</p>
        </div>
      )}

    </div>
  );
}
