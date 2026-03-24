"use client";

import { useEffect, useState, useRef } from "react";

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
const HALF_CIRC = Math.PI * 110; // ≈ 345.6

// Tick-up animation hook
function useTickUp(target: number, duration = 1000, delay = 0): number {
  const [value, setValue] = useState(0);
  const startTime = useRef<number | null>(null);

  useEffect(() => {
    if (target <= 0) { setValue(0); return; }

    const timeout = setTimeout(() => {
      const tick = (timestamp: number) => {
        if (!startTime.current) startTime.current = timestamp;
        const elapsed = timestamp - startTime.current;
        const progress = Math.min(elapsed / duration, 1);
        // Ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(Math.round(eased * target));
        if (progress < 1) requestAnimationFrame(tick);
      };
      startTime.current = null;
      requestAnimationFrame(tick);
    }, delay);

    return () => clearTimeout(timeout);
  }, [target, duration, delay]);

  return value;
}

export default function SelfPoweredRing({ selfPoweredPct, solarPct = 0, batteryPct = 0, label = "Self-Powered", glass, live }: Props) {
  const pct = Math.max(0, Math.min(100, selfPoweredPct));
  const hasSplit = solarPct > 0 || batteryPct > 0;

  // Phase animation: solar first, then battery
  const [phase, setPhase] = useState(0); // 0=idle, 1=solar, 2=battery
  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 50);   // start solar
    const t2 = setTimeout(() => setPhase(2), 1100);  // start battery after solar finishes
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // Tick-up numbers
  const displayPct = useTickUp(pct, 1200, 50);
  const displaySolar = useTickUp(Math.round(solarPct), 900, 100);
  const displayBattery = useTickUp(Math.round(batteryPct), 700, 1100);

  // Solar arc
  const solarLen = (solarPct / 100) * HALF_CIRC;
  const solarDasharray = `${solarLen} ${HALF_CIRC}`;
  const solarDashoffset = phase >= 1 ? 0 : solarLen;

  // Battery arc — hidden until phase 2
  const batteryLen = (batteryPct / 100) * HALF_CIRC;
  const batteryDasharray = phase >= 2
    ? `0 ${solarLen} ${batteryLen} ${HALF_CIRC}`
    : `0 ${solarLen} 0 ${HALF_CIRC}`;

  // Single color mode
  const singleColor = pct >= 80 ? BATTERY_COLOR : pct >= 40 ? SOLAR_COLOR : "#f87171";
  const singleLen = (pct / 100) * HALF_CIRC;
  const singleDashoffset = phase >= 1 ? 0 : singleLen;

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
              {/* Solar segment (yellow) — animates first, round start cap */}
              {solarLen > 0.5 && (
                <path
                  d={ARC_PATH}
                  fill="none"
                  stroke={SOLAR_COLOR}
                  strokeWidth="14"
                  strokeLinecap="round"
                  strokeDasharray={`${solarLen} ${HALF_CIRC}`}
                  strokeDashoffset={solarDashoffset}
                  style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)" }}
                />
              )}
              {/* Battery segment (green) — animates after solar */}
              {batteryLen > 0.5 && (
                <path
                  d={ARC_PATH}
                  fill="none"
                  stroke={BATTERY_COLOR}
                  strokeWidth="14"
                  strokeLinecap="butt"
                  strokeDasharray={batteryDasharray}
                  style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.4, 0, 0.2, 1)" }}
                />
              )}
            </>
          ) : (
            <path
              d={ARC_PATH}
              fill="none"
              stroke={singleColor}
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={`${singleLen} ${HALF_CIRC}`}
              strokeDashoffset={singleDashoffset}
              style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.8s ease" }}
            />
          )}
        </svg>
        {/* Centered number — ticks up */}
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-3">
          <span className="text-4xl sm:text-6xl font-bold text-white tabular-nums">{displayPct}%</span>
          {hasSplit ? (
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-[11px] sm:text-xs text-gray-500 flex items-center gap-1 tabular-nums">
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: SOLAR_COLOR }} />
                {displaySolar}% solar
              </span>
              <span className="text-[11px] sm:text-xs text-gray-500 flex items-center gap-1 tabular-nums">
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: BATTERY_COLOR }} />
                {displayBattery}% powerwall
              </span>
            </div>
          ) : (
            <span className={`text-xs sm:text-sm ${glass ? "text-white/40" : "text-gray-500"}`}>solar + powerwall</span>
          )}
        </div>
      </div>
    </div>
  );
}
