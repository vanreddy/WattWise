"use client";

import { useEffect, useState } from "react";

interface Props {
  selfPoweredPct: number; // 0–100
  solarPct?: number; // 0–100, portion from solar
  batteryPct?: number; // 0–100, portion from battery
  label?: string;
  glass?: boolean;
  live?: boolean;
}

const SOLAR_COLOR = "#facc15";
const BATTERY_COLOR = "#34d399";
const TRACK_COLOR = "#374151";

const ARC_PATH = "M 20 130 A 110 110 0 0 1 240 130";
const HALF_CIRC = Math.PI * 110; // semi-circle length ≈ 345.6

export default function SelfPoweredRing({ selfPoweredPct, solarPct = 0, batteryPct = 0, label = "Self-Powered", glass, live }: Props) {
  const pct = Math.max(0, Math.min(100, selfPoweredPct));
  const hasSplit = solarPct > 0 || batteryPct > 0;

  // Animate on mount: start from 0 and transition to target
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Solar: draws from left, length = solarPct portion of arc
  // Use dashoffset to hide it initially, then animate to 0
  const solarLen = (solarPct / 100) * HALF_CIRC;
  const solarDasharray = `${solarLen} ${HALF_CIRC}`;
  const solarDashoffset = animated ? 0 : solarLen; // start hidden, animate to visible

  // Battery: draws after solar
  // dasharray = [gap for solar] [battery length] [rest hidden]
  const batteryLen = (batteryPct / 100) * HALF_CIRC;
  const batteryDasharray = `0 ${solarLen} ${batteryLen} ${HALF_CIRC}`;

  // Single color mode
  const singleColor = pct >= 80 ? BATTERY_COLOR : pct >= 40 ? SOLAR_COLOR : "#f87171";
  const singleLen = (pct / 100) * HALF_CIRC;
  const singleDashoffset = animated ? 0 : singleLen;

  return (
    <div className={glass ? "flex flex-col items-center justify-center" : "card-elevated rounded-2xl p-3 sm:p-4 border border-gray-800/50 flex flex-col items-center justify-center"}>
      <h2 className={`text-sm font-semibold mb-1 ${glass ? "text-white/60" : "text-gray-400"} flex items-center gap-2 justify-center`}>
        {live && <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" /></span>}
        {label}
      </h2>
      <div className="relative w-56 h-36 sm:w-72 sm:h-44">
        <svg viewBox="0 0 260 150" className="w-full h-full">
          {/* Background track */}
          <path d={ARC_PATH} fill="none" stroke={glass ? "rgba(255,255,255,0.1)" : TRACK_COLOR} strokeWidth="14" strokeLinecap="round" />

          {hasSplit ? (
            <>
              {/* Solar segment (yellow) — starts from left */}
              {solarLen > 0.5 && (
                <path
                  d={ARC_PATH}
                  fill="none"
                  stroke={SOLAR_COLOR}
                  strokeWidth="14"
                  strokeLinecap="butt"
                  strokeDasharray={solarDasharray}
                  strokeDashoffset={solarDashoffset}
                  style={{ transition: "stroke-dashoffset 1s ease-out" }}
                />
              )}
              {/* Battery segment (green) — starts after solar */}
              {batteryLen > 0.5 && (
                <path
                  d={ARC_PATH}
                  fill="none"
                  stroke={BATTERY_COLOR}
                  strokeWidth="14"
                  strokeLinecap="butt"
                  strokeDasharray={batteryDasharray}
                  style={{ transition: "stroke-dasharray 1s ease-out" }}
                />
              )}
            </>
          ) : (
            /* Single color arc */
            <path
              d={ARC_PATH}
              fill="none"
              stroke={singleColor}
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={`${singleLen} ${HALF_CIRC}`}
              strokeDashoffset={singleDashoffset}
              style={{ transition: "stroke-dashoffset 1s ease-out, stroke 0.8s ease" }}
            />
          )}
        </svg>
        {/* Centered number */}
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-3">
          <span className="text-4xl sm:text-6xl font-bold text-white">{Math.round(pct)}%</span>
          {hasSplit ? (
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-[11px] sm:text-xs text-gray-500 flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: SOLAR_COLOR }} />
                {Math.round(solarPct)}% solar
              </span>
              <span className="text-[11px] sm:text-xs text-gray-500 flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: BATTERY_COLOR }} />
                {Math.round(batteryPct)}% battery
              </span>
            </div>
          ) : (
            <span className={`text-xs sm:text-sm ${glass ? "text-white/40" : "text-gray-500"}`}>solar + battery</span>
          )}
        </div>
      </div>
    </div>
  );
}
