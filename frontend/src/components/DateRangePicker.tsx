"use client";

import { useState, useRef, useEffect } from "react";

export interface DateRange {
  label: string;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  days: number;
}

function toDateStr(d: Date): string {
  // Use local date components, not UTC — toISOString() gives UTC which drifts after 4/5pm Pacific
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

const PRESETS: { label: string; getDates: () => { from: string; to: string; days: number } }[] = [
  {
    label: "Today",
    getDates: () => {
      const today = toDateStr(new Date());
      return { from: today, to: today, days: 1 };
    },
  },
  {
    label: "7 Days",
    getDates: () => ({
      from: toDateStr(daysAgo(6)),
      to: toDateStr(new Date()),
      days: 7,
    }),
  },
  {
    label: "30 Days",
    getDates: () => ({
      from: toDateStr(daysAgo(29)),
      to: toDateStr(new Date()),
      days: 30,
    }),
  },
];

export default function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState(value.from);
  const [customTo, setCustomTo] = useState(value.to);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowCustom(false);
      }
    }
    if (showCustom) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showCustom]);

  const applyCustom = () => {
    if (customFrom && customTo && customFrom <= customTo) {
      const d1 = new Date(customFrom);
      const d2 = new Date(customTo);
      const days = Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1;
      onChange({ label: "Custom", from: customFrom, to: customTo, days });
      setShowCustom(false);
    }
  };

  return (
    <div className="flex items-center gap-2 relative">
      {PRESETS.map((p) => (
        <button
          key={p.label}
          onClick={() => {
            const { from, to, days } = p.getDates();
            onChange({ label: p.label, from, to, days });
            setShowCustom(false);
          }}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            value.label === p.label
              ? "bg-blue-600 text-white"
              : "bg-gray-800 text-gray-400 hover:bg-gray-700"
          }`}
        >
          {p.label}
        </button>
      ))}

      {/* Custom range button */}
      <button
        onClick={() => {
          setCustomFrom(value.from);
          setCustomTo(value.to);
          setShowCustom(!showCustom);
        }}
        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          value.label === "Custom"
            ? "bg-blue-600 text-white"
            : "bg-gray-800 text-gray-400 hover:bg-gray-700"
        }`}
      >
        Custom
      </button>

      {/* Custom date popover */}
      {showCustom && (
        <div
          ref={popoverRef}
          className="absolute top-full right-0 mt-2 bg-gray-800 border border-gray-700 rounded-xl p-4 shadow-xl z-50"
        >
          <div className="flex items-center gap-2 mb-3">
            <div>
              <label className="text-[10px] text-gray-500 block mb-1">From</label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300"
              />
            </div>
            <span className="text-gray-500 mt-4">→</span>
            <div>
              <label className="text-[10px] text-gray-500 block mb-1">To</label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300"
              />
            </div>
          </div>
          <button
            onClick={applyCustom}
            className="w-full bg-blue-600 text-white text-xs font-medium py-1.5 rounded-lg hover:bg-blue-500 transition-colors"
          >
            Apply
          </button>
        </div>
      )}

      {/* Show range label */}
      {value.label === "Custom" && (
        <span className="text-xs text-gray-500 ml-1">
          {value.from} — {value.to}
        </span>
      )}
    </div>
  );
}
