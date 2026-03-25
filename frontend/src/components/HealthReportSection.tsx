"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, TrendingDown } from "lucide-react";
import { useHealthReport, type HealthReport, type ReportChip } from "@/hooks/useHealthReport";

/* ─── Analyzing state ────────────────────────── */

const SCAN_ITEMS = [
  { icon: "☀️", label: "Solar generation patterns" },
  { icon: "🚗", label: "EV charging behavior" },
  { icon: "🔋", label: "Battery peak coverage" },
];

function AnalyzingCard({ insufficient }: { insufficient: boolean }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
      <div className="px-4 pt-4 pb-5">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <TrendingDown size={14} className="text-purple-400" />
          <span className="text-sm font-semibold text-gray-400">Energy Health Report</span>
        </div>

        {insufficient ? (
          /* Not enough data yet */
          <div className="text-center py-3">
            <div className="text-2xl mb-2">📡</div>
            <p className="text-sm font-medium text-gray-300 mb-1">Gathering your data</p>
            <p className="text-xs text-gray-500 leading-relaxed">
              We need at least a week of readings to build your report. Check back in a few days.
            </p>
          </div>
        ) : (
          /* Actively fetching + analyzing */
          <>
            <p className="text-sm font-medium text-gray-200 mb-1">
              Building your energy health report
            </p>
            <p className="text-xs text-gray-500 mb-4">
              Reviewing 90 days of data…
            </p>

            <div className="space-y-3">
              {SCAN_ITEMS.map((item, i) => (
                <div
                  key={item.label}
                  className="flex items-center gap-3 animate-pulse"
                  style={{ animationDelay: `${i * 0.3}s`, animationDuration: "1.8s" }}
                >
                  <span className="text-base w-6 text-center">{item.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-400">{item.label}</span>
                    </div>
                    <div className="h-1 rounded-full bg-gray-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-purple-500/40 to-purple-400/20"
                        style={{
                          width: `${55 + i * 15}%`,
                          animation: `shimmer 2s ease-in-out infinite`,
                          animationDelay: `${i * 0.4}s`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes shimmer {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

/* ─── Chip (expandable action) ───────────────── */

const DOT_STYLES = {
  red:   "bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]",
  amber: "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.4)]",
  green: "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]",
};

function Chip({ chip }: { chip: ReportChip }) {
  const [open, setOpen] = useState(false);

  return (
    <button
      onClick={() => setOpen(o => !o)}
      className={`w-full text-left rounded-xl border transition-colors ${
        open ? "bg-gray-800/60 border-gray-700" : "bg-gray-800/30 border-gray-800 hover:border-gray-700"
      }`}
    >
      {/* Row */}
      <div className="flex items-center gap-3 px-3 py-3">
        <span className={`w-2 h-2 rounded-full shrink-0 ${DOT_STYLES[chip.dotColor]}`} />
        <span className="flex-1 text-sm font-semibold text-gray-200 text-left leading-snug">
          {chip.name}
        </span>
        <span className="text-xs font-bold text-emerald-400 shrink-0 whitespace-nowrap">
          {chip.saving}
        </span>
        {open
          ? <ChevronUp size={12} className="text-gray-600 shrink-0" />
          : <ChevronDown size={12} className="text-gray-600 shrink-0" />}
      </div>

      {/* Detail panel */}
      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2.5 border-t border-gray-800/70">
          <p className="text-xs text-gray-500 leading-relaxed pt-2.5">{chip.finding}</p>
          <div className="bg-gray-900 rounded-lg px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-600 mb-1">Action</p>
            <p className="text-xs text-gray-300 leading-relaxed">{chip.action}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-full px-2.5 py-0.5">
              {chip.saving}
            </span>
            <span className="text-[11px] text-gray-600">estimated monthly</span>
          </div>
        </div>
      )}
    </button>
  );
}

/* ─── Health report card (Format C) ─────────── */

function HealthReportCard({ report }: { report: HealthReport }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="bg-gray-900 border border-gray-700/80 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <TrendingDown size={14} className="text-purple-400" />
          <span className="text-sm font-semibold text-gray-200">Energy Health Report</span>
          {report.isWeeklyUpdate && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400 bg-purple-400/10 border border-purple-400/20 rounded-full px-2 py-0.5">
              Weekly Update
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-600 font-medium">
            {report.periodLabel} · {report.days}d
          </span>
          <button
            onClick={() => setCollapsed(c => !c)}
            className="text-gray-600 hover:text-gray-400 transition-colors p-0.5"
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Narrative */}
          <div className="px-4 pt-3 pb-3 border-b border-gray-800/60">
            <p className="text-sm text-gray-300 leading-relaxed">{report.narrative}</p>
          </div>

          {/* Chips */}
          <div className="px-3 pt-2.5 pb-1">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-600">
                Actions
              </span>
              <span className="text-xs font-bold text-emerald-400">
                ${report.potentialLow}–{report.potentialHigh}/mo available
              </span>
            </div>
            <div className="flex flex-col gap-1.5 pb-2">
              {report.chips.map((chip, i) => (
                <Chip key={i} chip={chip} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Orchestrator ───────────────────────────── */

export default function HealthReportSection() {
  const { status, reports } = useHealthReport();

  if (status === "fetching" && reports.length === 0) return <AnalyzingCard insufficient={false} />;
  if (status === "insufficient") return <AnalyzingCard insufficient={true} />;
  if (reports.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {status === "fetching" && <AnalyzingCard insufficient={false} />}
      {reports.map(report => (
        <HealthReportCard key={report.generatedAt} report={report} />
      ))}
    </div>
  );
}
