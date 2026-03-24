"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  Sun,
  Home,
  Zap,
  BatteryMedium,
  Battery,
  Bell,
  Activity,
  DollarSign,
  BarChart3,
  TrendingUp,
} from "lucide-react";

// Real chart components
import LiveSankeyChart from "@/components/LiveSankeyChart";
import SankeyChart from "@/components/SankeyChart";
import HourlyChart from "@/components/HourlyChart";
import CostTiles from "@/components/CostTiles";
import SelfPoweredRing from "@/components/SelfPoweredRing";
import AlertsList from "@/components/AlertsList";

// Mock data matching real API types
import {
  MOCK_CURRENT,
  MOCK_HOURLY,
  MOCK_DAILY,
  MOCK_SANKEY,
  MOCK_ALERTS,
} from "./mockData";

/* ═══════════════════════════════════════════════════════════════════════
   DESIGN TOKENS — Premium Dark Glass
   ═══════════════════════════════════════════════════════════════════════ */

const C = {
  // Backgrounds
  bg: "#0D1117",              // GitHub-dark base
  bgAlt: "#161B22",           // slightly lifted surface
  glass: "rgba(255,255,255,0.04)",      // subtle glass
  glassHover: "rgba(255,255,255,0.08)", // hover state
  glassBorder: "rgba(255,255,255,0.06)",
  glassBorderHover: "rgba(255,255,255,0.12)",

  // Text
  text: "#E6EDF3",            // bright white-ish
  textMuted: "#8B949E",       // mid-gray
  textDim: "#484F58",         // subtle labels

  // Vibrant accents
  solar: "#FFAC33",           // warm amber (pops on dark)
  home: "#58A6FF",            // electric blue
  battery: "#BC8CFF",         // vivid purple
  gridExport: "#3FB950",      // neon green
  gridImport: "#FF7B72",      // coral red
  savings: "#3FB950",         // match grid export green
  accent: "#58A6FF",          // primary interactive blue
};

/* ═══════════════════════════════════════════════════════════════════════
   ANIMATED NUMBER HOOK — Values count up on mount
   ═══════════════════════════════════════════════════════════════════════ */

function useAnimatedNumber(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const ref = useRef<number | null>(null);

  useEffect(() => {
    const start = performance.now();
    function tick(now: number) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // cubic ease-out
      setValue(target * eased);
      if (t < 1) ref.current = requestAnimationFrame(tick);
    }
    ref.current = requestAnimationFrame(tick);
    return () => {
      if (ref.current) cancelAnimationFrame(ref.current);
    };
  }, [target, duration]);

  return value;
}

/* ═══════════════════════════════════════════════════════════════════════
   PULSING LIVE DOT — Shows data is real-time
   ═══════════════════════════════════════════════════════════════════════ */

function PulseDot({ color }: { color: string }) {
  return (
    <span className="relative inline-flex h-2 w-2">
      <span
        className="absolute inline-flex h-full w-full rounded-full opacity-75"
        style={{
          backgroundColor: color,
          animation: "ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite",
        }}
      />
      <span
        className="relative inline-flex rounded-full h-2 w-2"
        style={{ backgroundColor: color }}
      />
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   GLASS CARD — Reusable translucent card with hover lift
   ═══════════════════════════════════════════════════════════════════════ */

function GlassCard({ children, className = "", hover = true }: {
  children: React.ReactNode; className?: string; hover?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl ${className}`}
      style={{
        background: C.glass,
        border: `1px solid ${C.glassBorder}`,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.04)",
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        ...(hover ? { cursor: "default" } : {}),
      }}
      onMouseEnter={(e) => {
        if (!hover) return;
        e.currentTarget.style.background = C.glassHover;
        e.currentTarget.style.borderColor = C.glassBorderHover;
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)";
      }}
      onMouseLeave={(e) => {
        if (!hover) return;
        e.currentTarget.style.background = C.glass;
        e.currentTarget.style.borderColor = C.glassBorder;
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.04)";
      }}
    >
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   HERO RING — Animated gradient arc with glow pulse
   ═══════════════════════════════════════════════════════════════════════ */

function HeroRing({ pct }: { pct: number }) {
  const animPct = useAnimatedNumber(pct, 1800);
  const radius = 90;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - animPct / 100);

  return (
    <div className="relative flex items-center justify-center" style={{ width: 280, height: 280, margin: "0 auto" }}>
      {/* Ambient glow behind ring */}
      <div
        className="absolute rounded-full"
        style={{
          width: 220, height: 220,
          background: `conic-gradient(from 0deg, ${C.accent}30, ${C.solar}25, ${C.battery}20, ${C.accent}30)`,
          filter: "blur(40px)",
          animation: "ring-breathe 4s ease-in-out infinite",
        }}
      />

      <svg width="280" height="280" viewBox="0 0 280 280" className="relative z-10">
        <defs>
          <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={C.accent}>
              <animate attributeName="stop-color" values={`${C.accent};${C.gridExport};${C.accent}`} dur="6s" repeatCount="indefinite" />
            </stop>
            <stop offset="35%" stopColor={C.gridExport} />
            <stop offset="65%" stopColor={C.battery} />
            <stop offset="100%" stopColor={C.solar}>
              <animate attributeName="stop-color" values={`${C.solar};${C.battery};${C.solar}`} dur="6s" repeatCount="indefinite" />
            </stop>
          </linearGradient>
          <filter id="ring-glow">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Track */}
        <circle cx="140" cy="140" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" strokeLinecap="round" />

        {/* Animated arc */}
        <circle
          cx="140" cy="140" r={radius}
          fill="none"
          stroke="url(#ring-grad)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          filter="url(#ring-glow)"
          style={{ transform: "rotate(-90deg)", transformOrigin: "center", transition: "stroke-dashoffset 0.3s ease" }}
        />

        {/* Tick marks */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const angle = -90 + frac * 360;
          const rad = (angle * Math.PI) / 180;
          const inner = radius - 8;
          const outer = radius + 8;
          return (
            <line
              key={frac}
              x1={140 + inner * Math.cos(rad)} y1={140 + inner * Math.sin(rad)}
              x2={140 + outer * Math.cos(rad)} y2={140 + outer * Math.sin(rad)}
              stroke={C.textDim} strokeWidth="1.5" strokeLinecap="round"
            />
          );
        })}
      </svg>

      {/* Center text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center z-20">
        <span style={{ fontSize: 10, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.2em", fontWeight: 500 }}>
          Self-Powered
        </span>
        <span style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 60, fontWeight: 200, color: C.text, lineHeight: 1, marginTop: 6 }}>
          {Math.round(animPct)}
          <span style={{ fontSize: 28, color: C.textMuted, fontWeight: 300 }}>%</span>
        </span>
        <span style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>solar + battery</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   LIVE METRIC TILE — Glass card with animated number + pulse dot
   ═══════════════════════════════════════════════════════════════════════ */

function formatPower(watts: number): string {
  const abs = Math.abs(watts);
  if (abs >= 1000) return `${(abs / 1000).toFixed(1)}`;
  return `${Math.round(abs)}`;
}

function formatPowerUnit(watts: number): string {
  return Math.abs(watts) >= 1000 ? "kW" : "W";
}

function MetricTile({ icon, label, watts, subLabel, color }: {
  icon: React.ReactNode; label: string; watts: number; subLabel: string; color: string;
}) {
  const animVal = useAnimatedNumber(Math.abs(watts), 1000);
  const displayVal = Math.abs(watts) >= 1000 ? (animVal / 1000).toFixed(1) : Math.round(animVal).toString();
  const unit = formatPowerUnit(watts);

  return (
    <GlassCard className="py-5 px-3">
      <div className="flex flex-col items-center gap-2.5">
        <div className="flex items-center gap-2">
          <span style={{ color }}>{icon}</span>
          <PulseDot color={color} />
        </div>
        <div className="text-center">
          <span style={{ fontSize: 28, fontWeight: 200, color: C.text, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            {displayVal}
          </span>
          <span style={{ fontSize: 13, color: C.textMuted, marginLeft: 3, fontWeight: 400 }}>{unit}</span>
        </div>
        <div className="text-center">
          <span style={{ fontSize: 10, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.12em" }}>{label}</span>
          <br />
          <span style={{ fontSize: 10, color, fontWeight: 500 }}>{subLabel}</span>
        </div>
      </div>
    </GlassCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   BATTERY STATUS — Dark glass version
   ═══════════════════════════════════════════════════════════════════════ */

function BatteryStatus({ batteryPct, batteryW }: { batteryPct: number; batteryW: number }) {
  const pct = Math.round(batteryPct);
  const animPct = useAnimatedNumber(pct, 1200);
  const isCharging = batteryW < -10;
  const isDischarging = batteryW > 10;
  const status = isCharging ? "Charging" : isDischarging ? "Discharging" : "Idle";

  const barColor = pct >= 60 ? C.gridExport : pct >= 20 ? C.solar : C.gridImport;

  return (
    <GlassCard className="p-4 flex items-center gap-4">
      <Battery size={22} style={{ color: barColor }} />
      <div className="flex-1">
        <div className="flex justify-between items-baseline mb-2">
          <span style={{ fontSize: 14, fontWeight: 500, color: C.text }}>Powerwall</span>
          <div className="flex items-center gap-1.5">
            <PulseDot color={barColor} />
            <span style={{ fontSize: 20, fontWeight: 300, color: barColor, fontVariantNumeric: "tabular-nums" }}>
              {Math.round(animPct)}%
            </span>
          </div>
        </div>
        <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${barColor}88, ${barColor})`, boxShadow: `0 0 8px ${barColor}40` }}
          />
        </div>
        <p style={{ fontSize: 10, color: C.textDim, marginTop: 4, textTransform: "uppercase", letterSpacing: "0.1em" }}>{status}</p>
      </div>
    </GlassCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   SAVINGS HERO — Animated counter with glow
   ═══════════════════════════════════════════════════════════════════════ */

function SavingsHero() {
  const solarSavings = MOCK_DAILY[0].solar_self_consumed_kwh * 0.45;
  const exportCredits = MOCK_DAILY[0].export_credit;
  const gridCosts = MOCK_DAILY[0].total_cost;
  const net = solarSavings + exportCredits - gridCosts;
  const animNet = useAnimatedNumber(net, 1400);

  return (
    <GlassCard className="py-8 px-6 text-center" hover={false}>
      <div className="flex items-center justify-center gap-2 mb-2">
        <TrendingUp size={22} style={{ color: C.savings }} />
        <span style={{ fontSize: 48, fontWeight: 200, color: C.savings, lineHeight: 1, fontVariantNumeric: "tabular-nums", textShadow: `0 0 30px ${C.savings}30` }}>
          ${animNet.toFixed(2)}
        </span>
      </div>
      <span style={{ fontSize: 11, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.15em" }}>net savings today</span>
    </GlassCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   BOTTOM TAB BAR — Frosted glass with active glow
   ═══════════════════════════════════════════════════════════════════════ */

function BottomTabBar({ active, onChange }: { active: string; onChange: (tab: string) => void }) {
  const tabs = [
    { id: "now", label: "Now", icon: <Activity size={20} /> },
    { id: "flow", label: "Flow", icon: <BarChart3 size={20} /> },
    { id: "savings", label: "Savings", icon: <DollarSign size={20} /> },
    { id: "alerts", label: "Alerts", icon: <Bell size={20} /> },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around py-2 pb-6"
      style={{
        background: "rgba(13, 17, 23, 0.85)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        borderTop: `1px solid ${C.glassBorder}`,
      }}
    >
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className="flex flex-col items-center gap-1 px-5 py-1 transition-all duration-300"
            style={{
              color: isActive ? C.accent : C.textDim,
              transform: isActive ? "scale(1.08)" : "scale(1)",
              filter: isActive ? `drop-shadow(0 0 6px ${C.accent}40)` : "none",
            }}
          >
            {tab.icon}
            <span style={{ fontSize: 10, fontWeight: isActive ? 600 : 400, letterSpacing: "0.08em" }}>{tab.label}</span>
            {isActive && (
              <div
                className="w-1 h-1 rounded-full"
                style={{ background: C.accent, marginTop: -2, boxShadow: `0 0 6px ${C.accent}` }}
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION LABEL
   ═══════════════════════════════════════════════════════════════════════ */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontSize: 10,
      color: C.textDim,
      textTransform: "uppercase",
      letterSpacing: "0.2em",
      fontWeight: 600,
      marginBottom: 12,
    }}>
      {children}
    </h2>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════════════ */

export default function PrototypePage() {
  const [activeTab, setActiveTab] = useState("now");

  const selfPowered = useMemo(() => {
    const totalConsumption = MOCK_SANKEY.solar_to_home + MOCK_SANKEY.battery_to_home + MOCK_SANKEY.grid_to_home;
    return totalConsumption > 0
      ? ((totalConsumption - MOCK_SANKEY.grid_to_home) / totalConsumption) * 100
      : 0;
  }, []);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600&display=swap"
        rel="stylesheet"
      />

      <style>{`
        html.dark body, body {
          background: ${C.bg} !important;
          color: ${C.text} !important;
        }
        .proto-v2 * {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        header:has(+ main .proto-v2) { display: none; }

        /* ── Glass card overrides for real components ── */
        .proto-v2 .bg-gray-900 {
          background: ${C.glass} !important;
          border-color: ${C.glassBorder} !important;
          box-shadow: 0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.04) !important;
          backdrop-filter: blur(12px) !important;
          -webkit-backdrop-filter: blur(12px) !important;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .proto-v2 .bg-gray-900:hover {
          background: ${C.glassHover} !important;
          border-color: ${C.glassBorderHover} !important;
          transform: translateY(-2px);
          box-shadow: 0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06) !important;
        }
        .proto-v2 .border-gray-800 {
          border-color: ${C.glassBorder} !important;
        }
        .proto-v2 .bg-gray-800 {
          background: rgba(255,255,255,0.03) !important;
        }
        .proto-v2 .bg-gray-700 {
          background: rgba(255,255,255,0.06) !important;
        }
        .proto-v2 .border-gray-700 {
          border-color: ${C.glassBorder} !important;
        }

        /* ── Animations ── */
        @keyframes ping {
          75%, 100% { transform: scale(2.5); opacity: 0; }
        }
        @keyframes ring-breathe {
          0%, 100% { opacity: 0.5; transform: scale(0.95); }
          50% { opacity: 0.8; transform: scale(1.05); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fade-up {
          animation: fadeUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .fade-up-1 { animation-delay: 0s; }
        .fade-up-2 { animation-delay: 0.1s; }
        .fade-up-3 { animation-delay: 0.18s; }
        .fade-up-4 { animation-delay: 0.26s; }
        .fade-up-5 { animation-delay: 0.34s; }
        .fade-up-6 { animation-delay: 0.42s; }

        /* ── Ambient background glow ── */
        .proto-bg {
          background-image:
            radial-gradient(ellipse at 20% 0%, rgba(88, 166, 255, 0.08) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 90%, rgba(188, 140, 255, 0.06) 0%, transparent 50%),
            radial-gradient(ellipse at 50% 40%, rgba(255, 172, 51, 0.04) 0%, transparent 60%);
        }
      `}</style>

      <div className="proto-v2 proto-bg min-h-screen" style={{ paddingBottom: 100 }}>
        {/* Header — frosted glass */}
        <header
          className="sticky top-0 z-40 px-5 py-4 flex items-center justify-between"
          style={{
            background: "rgba(13, 17, 23, 0.75)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            borderBottom: `1px solid ${C.glassBorder}`,
          }}
        >
          <div className="flex items-center gap-2">
            <Sun size={20} style={{ color: C.solar, filter: `drop-shadow(0 0 4px ${C.solar}60)` }} />
            <span style={{ fontSize: 18, fontWeight: 300, color: C.text, letterSpacing: "0.02em" }}>
              Self<span style={{ color: C.accent, fontWeight: 500 }}>Power</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <PulseDot color={C.gridExport} />
            <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 400 }}>Live</span>
          </div>
        </header>

        {/* Content */}
        <main className="max-w-lg mx-auto px-5 pt-6">
          {/* Date / greeting */}
          <div className="fade-up fade-up-1 mb-4">
            <p style={{ fontSize: 12, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: 500 }}>
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
            <h1 style={{ fontSize: 28, fontWeight: 200, color: C.text, lineHeight: 1.3, marginTop: 4 }}>
              Your Energy Day
            </h1>
          </div>

          {/* ── NOW TAB ──────────────────────────────────────────── */}
          {activeTab === "now" && (
            <>
              {/* Hero ring */}
              <div className="fade-up fade-up-2 mb-8">
                <HeroRing pct={selfPowered} />
                <p className="text-center mt-3" style={{ fontSize: 13, color: C.textMuted, fontStyle: "italic", fontWeight: 300 }}>
                  Excellent energy independence today
                </p>
              </div>

              {/* Live metrics */}
              <div className="fade-up fade-up-3 mb-6">
                <SectionLabel>Live Power</SectionLabel>
                <div className="grid grid-cols-2 gap-3">
                  <MetricTile icon={<Sun size={18} />} label="Solar" watts={MOCK_CURRENT.solar_w} subLabel="generating" color={C.solar} />
                  <MetricTile icon={<Home size={18} />} label="Home" watts={MOCK_CURRENT.home_w} subLabel="consuming" color={C.home} />
                  <MetricTile icon={<Zap size={18} />} label="Grid" watts={MOCK_CURRENT.grid_w} subLabel="exporting" color={C.gridExport} />
                  <MetricTile icon={<BatteryMedium size={18} />} label="Battery" watts={MOCK_CURRENT.battery_pct} subLabel="charging" color={C.battery} />
                </div>
              </div>

              {/* Live Sankey */}
              <div className="fade-up fade-up-4 mb-6">
                <SectionLabel>Energy Flow</SectionLabel>
                <LiveSankeyChart current={MOCK_CURRENT} />
              </div>

              {/* Battery Status */}
              <div className="fade-up fade-up-5 mb-6">
                <SectionLabel>Battery</SectionLabel>
                <BatteryStatus batteryPct={MOCK_CURRENT.battery_pct} batteryW={MOCK_CURRENT.battery_w} />
              </div>

              {/* Alerts */}
              <div className="fade-up fade-up-6 mb-6">
                <SectionLabel>Recent Activity</SectionLabel>
                <AlertsList alerts={MOCK_ALERTS} />
              </div>
            </>
          )}

          {/* ── FLOW TAB ─────────────────────────────────────────── */}
          {activeTab === "flow" && (
            <>
              <div className="fade-up fade-up-2 mb-6 mt-4 flex justify-center">
                <SelfPoweredRing selfPoweredPct={selfPowered} />
              </div>

              <div className="fade-up fade-up-3 mb-6">
                <SectionLabel>Today&apos;s Cost</SectionLabel>
                <CostTiles data={MOCK_DAILY} days={1} />
              </div>

              <div className="fade-up fade-up-4 mb-6">
                <SectionLabel>Energy Distribution</SectionLabel>
                <SankeyChart
                  hourlyData={MOCK_HOURLY}
                  dailyData={MOCK_DAILY}
                  days={1}
                  sankeyFlows={MOCK_SANKEY}
                />
              </div>

              <div className="fade-up fade-up-5 mb-6">
                <SectionLabel>24-Hour Flow</SectionLabel>
                <HourlyChart data={MOCK_HOURLY} days={1} />
              </div>
            </>
          )}

          {/* ── SAVINGS TAB ──────────────────────────────────────── */}
          {activeTab === "savings" && (
            <div className="fade-up fade-up-2 mt-6 space-y-6">
              <SavingsHero />
              <div>
                <SectionLabel>Breakdown</SectionLabel>
                <CostTiles data={MOCK_DAILY} days={1} />
              </div>
            </div>
          )}

          {/* ── ALERTS TAB ───────────────────────────────────────── */}
          {activeTab === "alerts" && (
            <div className="fade-up fade-up-2 mt-6">
              <SectionLabel>Activity Log</SectionLabel>
              <AlertsList alerts={MOCK_ALERTS} />
            </div>
          )}
        </main>

        {/* Bottom tab bar */}
        <BottomTabBar active={activeTab} onChange={setActiveTab} />
      </div>
    </>
  );
}
