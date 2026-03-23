"use client";

import { useMemo } from "react";

interface Props {
  selfPoweredPct: number; // 0–100
  label?: string;
  glass?: boolean;
}

function getColor(pct: number): string {
  // Red (0%) → Yellow (50%) → Green (100%)
  if (pct <= 50) {
    const r = 239;
    const g = Math.round(68 + (pct / 50) * (183 - 68));
    const b = 68;
    return `rgb(${r}, ${g}, ${b})`;
  }
  const r = Math.round(239 - ((pct - 50) / 50) * (239 - 34));
  const g = Math.round(183 + ((pct - 50) / 50) * (211 - 183));
  const b = Math.round(68 + ((pct - 50) / 50) * (153 - 68));
  return `rgb(${r}, ${g}, ${b})`;
}

export default function SelfPoweredRing({ selfPoweredPct, label = "Self-Powered", glass }: Props) {
  const pct = Math.max(0, Math.min(100, selfPoweredPct));

  const { arcLength, offset, color } = useMemo(() => {
    const radius = 110;
    // Semi-circle = half circumference (π * r)
    const halfCirc = Math.PI * radius;
    const off = halfCirc * (1 - pct / 100);
    return { arcLength: halfCirc, offset: off, color: getColor(pct) };
  }, [pct]);

  // SVG: center at (100, 100), radius 80, semi-circle from left to right (180°)
  // Arc goes from 9 o'clock (180°) to 3 o'clock (0°) — i.e. the top half
  // We rotate the group so the arc starts at bottom-left and sweeps to bottom-right
  return (
    <div className={glass ? "flex flex-col items-center justify-center" : "bg-gray-900 rounded-xl p-3 sm:p-4 border border-gray-800 flex flex-col items-center justify-center"}>
      <h2 className={`text-sm font-semibold mb-1 ${glass ? "text-white/60" : "text-gray-400"}`}>{label}</h2>
      <div className="relative w-56 h-36 sm:w-72 sm:h-44">
        <svg viewBox="0 0 260 150" className="w-full h-full">
          {/* Background track — semi-circle arc */}
          <path
            d="M 20 130 A 110 110 0 0 1 240 130"
            fill="none"
            stroke={glass ? "rgba(255,255,255,0.1)" : "#374151"}
            strokeWidth="14"
            strokeLinecap="round"
          />
          {/* Progress arc */}
          <path
            d="M 20 130 A 110 110 0 0 1 240 130"
            fill="none"
            stroke={color}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={arcLength}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.8s ease, stroke 0.8s ease" }}
          />
        </svg>
        {/* Centered number */}
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-3">
          <span className="text-4xl sm:text-6xl font-bold text-white">{Math.round(pct)}%</span>
          <span className={`text-xs sm:text-sm ${glass ? "text-white/40" : "text-gray-500"}`}>solar + battery</span>
        </div>
      </div>
    </div>
  );
}
