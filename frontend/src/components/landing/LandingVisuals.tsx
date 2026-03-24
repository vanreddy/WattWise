"use client";

import { useEffect, useState, useRef } from "react";
import { convertSankeyFlowsToFlows, renderSankey } from "@/components/SankeyChart";
import type { SankeyFlows } from "@/lib/api";

/* ═══════════════════════════════════════════════
   Shared constants
   ═══════════════════════════════════════════════ */
const SOLAR = "#facc15";
const BATTERY = "#34d399";
const GRID = "#f87171";
const HOME = "#60a5fa";
const EV = "#a78bfa";
const TRACK = "#374151";

/* ─── Tick-up hook ─── */
function useTickUp(target: number, duration: number, delay: number, active: boolean): number {
  const [value, setValue] = useState(0);
  const startTime = useRef<number | null>(null);

  useEffect(() => {
    if (!active) { setValue(0); return; }
    const timeout = setTimeout(() => {
      const tick = (timestamp: number) => {
        if (!startTime.current) startTime.current = timestamp;
        const elapsed = timestamp - startTime.current;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(Math.round(eased * target));
        if (progress < 1) requestAnimationFrame(tick);
      };
      startTime.current = null;
      requestAnimationFrame(tick);
    }, delay);
    return () => clearTimeout(timeout);
  }, [target, duration, delay, active]);

  return value;
}

/* ═══════════════════════════════════════════════
   Slide 0 — Animated Self-Powered Ring
   ═══════════════════════════════════════════════ */
export function RingVisual({ active }: { active: boolean }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!active) { setPhase(0); return; }
    const t1 = setTimeout(() => setPhase(1), 200);
    const t2 = setTimeout(() => setPhase(2), 1200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [active]);

  const displayPct = useTickUp(94, 1000, 200, active);

  const ARC = "M 30 150 A 120 120 0 0 1 270 150";
  const HALF = Math.PI * 120;
  const solarPct = 60;
  const batteryPct = 34;
  const solarLen = (solarPct / 100) * HALF;
  const batteryLen = (batteryPct / 100) * HALF;

  return (
    <div className="flex flex-col items-center justify-center h-full gap-1">
      <span className="text-sm font-semibold text-gray-400 tracking-wide">Self-Powered</span>
      <div className="relative w-80 h-56 sm:w-96 sm:h-68">
        <svg viewBox="0 0 300 170" className="w-full h-full">
          <path d={ARC} fill="none" stroke={TRACK} strokeWidth="16" strokeLinecap="round" />
          <path
            d={ARC} fill="none" stroke={SOLAR} strokeWidth="16" strokeLinecap="round"
            strokeDasharray={`${solarLen} ${HALF}`}
            strokeDashoffset={phase >= 1 ? 0 : solarLen}
            style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)" }}
          />
          <path
            d={ARC} fill="none" stroke={BATTERY} strokeWidth="16" strokeLinecap="butt"
            strokeDasharray={phase >= 2 ? `0 ${solarLen} ${batteryLen} ${HALF}` : `0 ${solarLen} 0 ${HALF}`}
            style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.4, 0, 0.2, 1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-2">
          <span className="text-5xl sm:text-6xl font-bold text-white tabular-nums">
            {displayPct}%
          </span>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SOLAR }} /> 60% solar
            </span>
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BATTERY }} /> 34% powerwall
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Slide 1 — Real SankeyChart with mock data
   ═══════════════════════════════════════════════ */

const MOCK_SANKEY: SankeyFlows = {
  solar_to_home: 30.2,
  solar_to_battery: 14.4,
  solar_to_grid: 11.3,
  battery_to_home: 16.5,
  battery_to_grid: 0,
  grid_to_home: 2.0,
  grid_to_battery: 0,
};

export function FlowVisual({ active }: { active: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!active) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 200);
    return () => clearTimeout(t);
  }, [active]);

  if (!show) return <div className="flex-1" />;

  const flows = convertSankeyFlowsToFlows(MOCK_SANKEY);

  return (
    <div className="flex items-center justify-center h-full px-0 -mx-4">
      {renderSankey(flows, true)}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Slide 2 — AI Insights (notification cards)
   ═══════════════════════════════════════════════ */
export function InsightsVisual({ active }: { active: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!active) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 300);
    return () => clearTimeout(t);
  }, [active]);

  const cards = [
    { icon: "⚡", text: "Solar peak detected: 8.2 kW", color: "border-yellow-500/30 bg-yellow-500/5", delay: "0ms" },
    { icon: "🔋", text: "Reserve 20% for evening peak", color: "border-green-500/30 bg-green-500/5", delay: "150ms" },
    { icon: "💡", text: "Shift dishwasher to 1–3 PM", color: "border-blue-500/30 bg-blue-500/5", delay: "300ms" },
    { icon: "📊", text: "You saved $4.20 today", color: "border-emerald-500/30 bg-emerald-500/5", delay: "450ms" },
  ];

  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-64 sm:w-72 space-y-3">
        {cards.map((c, i) => (
          <div
            key={i}
            className={`border rounded-xl px-4 py-3 flex items-center gap-3 transition-all duration-500 ${c.color} ${show ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
            style={{ transitionDelay: c.delay }}
          >
            <span className="text-lg">{c.icon}</span>
            <span className="text-sm text-gray-300">{c.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Slide 3 — Savings grow, Costs shrink
   ═══════════════════════════════════════════════ */
export function SavingsVisual({ active }: { active: boolean }) {
  const savings = useTickUp(97, 1500, 300, active);
  const costsDecrease = useTickUp(97, 1500, 300, active); // 147 → 50

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8">
      {/* Savings growing */}
      <div className="w-64 sm:w-72 space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-gray-400 font-medium">Savings</span>
          <span className="text-3xl sm:text-4xl font-bold text-green-400 tabular-nums">
            ${savings}
          </span>
        </div>
        <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-green-500 transition-all duration-1500 ease-out"
            style={{ width: active ? "52%" : "0%", transitionDuration: "1.5s", transitionDelay: "0.3s" }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-600">
          <span>$0</span>
          <span className="text-green-400/60">↑ growing</span>
        </div>
      </div>

      {/* Divider */}
      <div className="w-16 h-px bg-gray-800" />

      {/* Costs shrinking */}
      <div className="w-64 sm:w-72 space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-gray-400 font-medium">Grid Costs</span>
          <span className="text-3xl sm:text-4xl font-bold text-red-400 tabular-nums">
            ${147 - costsDecrease}
          </span>
        </div>
        <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-red-500 transition-all duration-1500 ease-out"
            style={{ width: active ? "34%" : "100%", transitionDuration: "1.5s", transitionDelay: "0.3s" }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-600">
          <span className="text-red-400/60">↓ shrinking</span>
          <span>$147</span>
        </div>
      </div>
    </div>
  );
}
