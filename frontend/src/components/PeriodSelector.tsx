"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DateRange } from "@/hooks/useDashboardData";

type Mode = "daily" | "weekly" | "monthly" | "custom";

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

function computeRange(mode: Mode, offset: number): DateRange {
  const now = new Date();

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

  const ds = toDateStr(now);
  return { label: "Custom", from: ds, to: ds, days: 1 };
}

interface Props {
  value: DateRange;
  onChange: (range: DateRange) => void;
  onModeChange?: (mode: Mode) => void;
  disabledPresets?: string[];
}

export default function PeriodSelector({ value, onChange, onModeChange }: Props) {
  const [mode, setMode] = useState<Mode>("daily");
  const [offset, setOffset] = useState(0);
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState(value.from);
  const [customTo, setCustomTo] = useState(value.to);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowCustom(false);
      }
    }
    if (showCustom) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showCustom]);

  const handleModeChange = (newMode: Mode) => {
    if (newMode === "custom") {
      setShowCustom(true);
      setMode("custom");
      onModeChange?.("custom");
      return;
    }
    setMode(newMode);
    setOffset(0);
    setShowCustom(false);
    const range = computeRange(newMode, 0);
    onChange(range);
    onModeChange?.(newMode);
  };

  const navigate = (dir: -1 | 1) => {
    if (mode === "custom") return;
    const newOffset = offset + dir;
    if (newOffset > 0) return;
    setOffset(newOffset);
    const range = computeRange(mode, newOffset);
    onChange(range);
  };

  const applyCustom = () => {
    if (customFrom && customTo && customFrom <= customTo) {
      const d1 = new Date(customFrom + "T12:00:00");
      const d2 = new Date(customTo + "T12:00:00");
      const days = Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1;
      onChange({ label: "Custom", from: customFrom, to: customTo, days });
      setShowCustom(false);
    }
  };

  const periodLabel = useMemo(() => {
    if (mode === "custom") return `${value.from} — ${value.to}`;
    if (mode === "daily") return formatDaily(value.from);
    if (mode === "weekly") return formatWeekly(value.from, value.to);
    return formatMonthly(value.from);
  }, [mode, value]);

  const canGoForward = offset < 0;

  const MODES: { id: Mode; label: string }[] = [
    { id: "daily", label: "Day" },
    { id: "weekly", label: "Week" },
    { id: "monthly", label: "Month" },
    { id: "custom", label: "Custom" },
  ];

  return (
    <div className="flex flex-col items-center gap-3 relative px-2">
      {/* Segmented control */}
      <div className="w-full max-w-sm bg-gray-800/60 rounded-2xl p-1 flex">
        {MODES.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => handleModeChange(id)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              mode === id
                ? "bg-gray-700 text-white shadow-md"
                : "text-gray-500 active:bg-gray-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Period navigation */}
      {mode !== "custom" ? (
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
      ) : (
        <div className="relative w-full max-w-sm">
          <button
            onClick={() => setShowCustom(!showCustom)}
            className="w-full py-2.5 text-sm font-medium text-gray-400 hover:text-gray-300 text-center"
          >
            {value.label === "Custom" && value.from !== value.to
              ? `${value.from} — ${value.to}`
              : "Tap to select dates"}
          </button>
          {showCustom && (
            <div
              ref={popoverRef}
              className="absolute top-full left-0 right-0 mt-2 bg-gray-800 border border-gray-700 rounded-2xl p-5 shadow-2xl z-50"
            >
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1.5">From</label>
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-300 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 block mb-1.5">To</label>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-300 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  onClick={applyCustom}
                  className="w-full bg-blue-600 text-white text-sm font-semibold py-3 rounded-xl hover:bg-blue-500 active:bg-blue-700 transition-colors"
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { computeRange };
export type { Mode };
