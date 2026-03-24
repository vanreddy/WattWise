"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DateRange } from "@/hooks/useDashboardData";

type Mode = "now" | "daily" | "weekly" | "monthly" | "yearly";

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDaily(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const today = new Date();
  const todayStr = toDateStr(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = toDateStr(yesterday);

  if (dateStr === todayStr) return "Today";
  if (dateStr === yesterdayStr) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatWeekly(from: string, to: string): string {
  const f = new Date(from + "T12:00:00");
  const t = new Date(to + "T12:00:00");
  const fStr = f.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const tStr = t.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fStr} – ${tStr}`;
}

function formatMonthly(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatYearly(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.getFullYear().toString();
}

function computeRange(mode: Mode, offset: number): DateRange {
  const now = new Date();

  if (mode === "now") {
    const ds = toDateStr(now);
    return { label: "Now", from: ds, to: ds, days: 1 };
  }

  if (mode === "daily") {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    const ds = toDateStr(d);
    return { label: "Daily", from: ds, to: ds, days: 1 };
  }

  if (mode === "weekly") {
    const d = new Date(now);
    const day = d.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + mondayOffset + offset * 7);
    const from = toDateStr(d);
    const sunday = new Date(d);
    sunday.setDate(sunday.getDate() + 6);
    const today = new Date(now);
    const to = sunday > today ? toDateStr(today) : toDateStr(sunday);
    const days = Math.round((new Date(to + "T12:00:00").getTime() - new Date(from + "T12:00:00").getTime()) / 86400000) + 1;
    return { label: "Weekly", from, to, days };
  }

  if (mode === "monthly") {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const from = toDateStr(d);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const today = new Date(now);
    const to = lastDay > today ? toDateStr(today) : toDateStr(lastDay);
    const days = Math.round((new Date(to + "T12:00:00").getTime() - new Date(from + "T12:00:00").getTime()) / 86400000) + 1;
    return { label: "Monthly", from, to, days };
  }

  if (mode === "yearly") {
    const year = now.getFullYear() + offset;
    const from = `${year}-01-01`;
    const lastDay = new Date(year, 11, 31);
    const today = new Date(now);
    const to = lastDay > today ? toDateStr(today) : toDateStr(lastDay);
    const days = Math.round((new Date(to + "T12:00:00").getTime() - new Date(from + "T12:00:00").getTime()) / 86400000) + 1;
    return { label: "Yearly", from, to, days };
  }

  const ds = toDateStr(now);
  return { label: "Daily", from: ds, to: ds, days: 1 };
}

const ALL_MODES: { id: Mode; label: string }[] = [
  { id: "now", label: "Now" },
  { id: "daily", label: "Day" },
  { id: "weekly", label: "Week" },
  { id: "monthly", label: "Month" },
  { id: "yearly", label: "Year" },
];

interface Props {
  value: DateRange;
  onChange: (range: DateRange) => void;
  onModeChange?: (mode: Mode) => void;
  modes?: Mode[];
  defaultMode?: Mode;
}

export default function PeriodSelector({ value, onChange, onModeChange, modes, defaultMode }: Props) {
  const availableModes = modes || ["daily", "weekly", "monthly", "yearly"];
  const [mode, setMode] = useState<Mode>(defaultMode || availableModes[0]);
  const [offset, setOffset] = useState(0);

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    setOffset(0);
    const range = computeRange(newMode, 0);
    onChange(range);
    onModeChange?.(newMode);
  };

  const navigate = (dir: -1 | 1) => {
    if (mode === "now") return;
    const newOffset = offset + dir;
    if (newOffset > 0) return;
    setOffset(newOffset);
    const range = computeRange(mode, newOffset);
    onChange(range);
  };

  const periodLabel = useMemo(() => {
    if (mode === "now") return "Live";
    if (mode === "daily") return formatDaily(value.from);
    if (mode === "weekly") return formatWeekly(value.from, value.to);
    if (mode === "yearly") return formatYearly(value.from);
    return formatMonthly(value.from);
  }, [mode, value]);

  const canGoForward = offset < 0;
  const isNow = mode === "now";

  const visibleModes = ALL_MODES.filter(m => availableModes.includes(m.id));

  return (
    <div className="flex flex-col items-center gap-3 relative px-2">
      {/* Segmented control */}
      <div className="w-full max-w-sm bg-gray-800/40 rounded-2xl p-1 flex backdrop-blur-sm border border-gray-700/20">
        {visibleModes.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => handleModeChange(id)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
              mode === id
                ? "bg-gray-700 text-white shadow-lg shadow-black/30"
                : "text-gray-500 hover:text-gray-300 active:bg-gray-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Period navigation — hidden for "now" mode */}
      {!isNow && (
        <div className="flex items-center w-full max-w-sm justify-between">
          <button
            onClick={() => navigate(-1)}
            className="p-2.5 rounded-xl text-gray-400 hover:text-white active:bg-gray-800 transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
          <span className="text-base font-semibold text-gray-200 min-w-[160px] text-center">
            {periodLabel}
          </span>
          <button
            onClick={() => navigate(1)}
            disabled={!canGoForward}
            className={`p-2.5 rounded-xl transition-colors ${
              canGoForward
                ? "text-gray-400 hover:text-white active:bg-gray-800"
                : "text-gray-800 cursor-not-allowed"
            }`}
          >
            <ChevronRight size={24} />
          </button>
        </div>
      )}
    </div>
  );
}

export { computeRange };
export type { Mode };
