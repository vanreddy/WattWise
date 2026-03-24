"use client";

import type { CurrentPower } from "@/lib/api";

function formatW(w: number): string {
  const abs = Math.abs(w);
  if (abs >= 1000) return `${(abs / 1000).toFixed(1)} kW`;
  return `${Math.round(abs)} W`;
}

interface FlowLine {
  x1: number; y1: number;
  x2: number; y2: number;
  color: string;
  watts: number;
  active: boolean;
}

export default function EnergyScene({ current }: { current: CurrentPower }) {
  const solar = Math.max(0, current.solar_w);
  const home = Math.max(0, current.home_w);
  const gridImport = Math.max(0, current.grid_w);
  const gridExport = Math.max(0, -current.grid_w);
  const batCharge = Math.max(0, -current.battery_w);
  const batDischarge = Math.max(0, current.battery_w);
  const ev = Math.max(0, current.vehicle_w);
  const batteryPct = Math.round(current.battery_pct);

  const isCharging = current.battery_w < -10;
  const isDischarging = current.battery_w > 10;
  const isExporting = current.grid_w < -10;

  // Flow lines: from source element to destination element
  const flows: FlowLine[] = [
    // Solar → Home (roof center to house center)
    { x1: 300, y1: 145, x2: 300, y2: 260, color: "#facc15", watts: Math.min(solar, home), active: solar > 10 && home > 10 },
    // Solar → Powerwall (roof to powerwall)
    { x1: 230, y1: 170, x2: 145, y2: 310, color: "#facc15", watts: batCharge, active: batCharge > 10 && solar > 10 },
    // Solar → Grid (roof right to grid)
    { x1: 400, y1: 155, x2: 520, y2: 250, color: "#facc15", watts: gridExport, active: isExporting && solar > 10 },
    // Powerwall → Home (powerwall to house center)
    { x1: 160, y1: 290, x2: 260, y2: 260, color: "#34d399", watts: batDischarge, active: isDischarging },
    // Grid → Home (grid to house right)
    { x1: 500, y1: 265, x2: 400, y2: 265, color: "#f87171", watts: gridImport, active: gridImport > 10 },
    // Home → EV (house bottom to EV)
    { x1: 200, y1: 340, x2: 130, y2: 400, color: "#a78bfa", watts: ev, active: ev > 10 },
  ];

  return (
    <div className="relative w-full">
      <svg viewBox="0 0 600 480" className="w-full h-auto">
        <defs>
          {/* Animated flow dash */}
          <style>{`
            @keyframes flowDash {
              to { stroke-dashoffset: -20; }
            }
            .flow-line {
              animation: flowDash 0.8s linear infinite;
            }
          `}</style>
        </defs>

        {/* === HOUSE BODY === */}
        {/* Main house wall */}
        <rect x="180" y="195" width="250" height="160" rx="4" fill="#1e293b" stroke="#334155" strokeWidth="1.5" />
        {/* Garage section */}
        <rect x="160" y="230" width="60" height="125" rx="3" fill="#1a2332" stroke="#334155" strokeWidth="1" />
        {/* Garage door lines */}
        <line x1="165" y1="260" x2="215" y2="260" stroke="#2d3a4a" strokeWidth="0.5" />
        <line x1="165" y1="290" x2="215" y2="290" stroke="#2d3a4a" strokeWidth="0.5" />
        <line x1="165" y1="320" x2="215" y2="320" stroke="#2d3a4a" strokeWidth="0.5" />

        {/* === ROOF === */}
        <polygon points="170,195 300,110 440,195" fill="#1a2332" stroke="#334155" strokeWidth="1.5" />

        {/* === SOLAR PANELS on roof === */}
        {/* Left panel */}
        <rect x="210" y="155" width="70" height="35" rx="2"
          fill={solar > 10 ? "#1e3a5f" : "#1a2332"}
          stroke={solar > 10 ? "#3b82f6" : "#334155"}
          strokeWidth="1"
        />
        {/* Panel grid lines */}
        <line x1="233" y1="155" x2="233" y2="190" stroke={solar > 10 ? "#2d5a8a" : "#2a3545"} strokeWidth="0.5" />
        <line x1="256" y1="155" x2="256" y2="190" stroke={solar > 10 ? "#2d5a8a" : "#2a3545"} strokeWidth="0.5" />
        <line x1="210" y1="172" x2="280" y2="172" stroke={solar > 10 ? "#2d5a8a" : "#2a3545"} strokeWidth="0.5" />
        {/* Right panel */}
        <rect x="290" y="155" width="70" height="35" rx="2"
          fill={solar > 10 ? "#1e3a5f" : "#1a2332"}
          stroke={solar > 10 ? "#3b82f6" : "#334155"}
          strokeWidth="1"
        />
        <line x1="313" y1="155" x2="313" y2="190" stroke={solar > 10 ? "#2d5a8a" : "#2a3545"} strokeWidth="0.5" />
        <line x1="336" y1="155" x2="336" y2="190" stroke={solar > 10 ? "#2d5a8a" : "#2a3545"} strokeWidth="0.5" />
        <line x1="290" y1="172" x2="360" y2="172" stroke={solar > 10 ? "#2d5a8a" : "#2a3545"} strokeWidth="0.5" />
        {/* Solar glow when active */}
        {solar > 10 && (
          <ellipse cx="300" cy="165" rx="85" ry="25" fill="#facc15" fillOpacity="0.06" />
        )}

        {/* === WINDOWS === */}
        <rect x="250" y="220" width="35" height="30" rx="2" fill="#0f172a" stroke="#475569" strokeWidth="0.8" />
        <rect x="300" y="220" width="35" height="30" rx="2" fill="#0f172a" stroke="#475569" strokeWidth="0.8" />
        <line x1="267" y1="220" x2="267" y2="250" stroke="#475569" strokeWidth="0.5" />
        <line x1="317" y1="220" x2="317" y2="250" stroke="#475569" strokeWidth="0.5" />
        {/* Window glow */}
        <rect x="252" y="222" width="31" height="26" rx="1" fill="#fbbf24" fillOpacity={home > 10 ? 0.08 : 0.02} />
        <rect x="302" y="222" width="31" height="26" rx="1" fill="#fbbf24" fillOpacity={home > 10 ? 0.08 : 0.02} />
        {/* Door */}
        <rect x="370" y="270" width="35" height="85" rx="2" fill="#0f172a" stroke="#475569" strokeWidth="0.8" />
        <circle cx="399" cy="315" r="2" fill="#475569" />

        {/* === POWERWALL (on left wall) === */}
        <rect x="130" y="265" width="28" height="55" rx="4" fill="#f8fafc" stroke="#94a3b8" strokeWidth="1" />
        {/* Battery fill level */}
        <rect
          x="133" y={268 + 49 * (1 - batteryPct / 100)}
          width="22" height={49 * (batteryPct / 100)}
          rx="2"
          fill={batteryPct >= 60 ? "#22c55e" : batteryPct >= 20 ? "#eab308" : "#ef4444"}
          fillOpacity="0.6"
        />
        {/* Tesla T logo hint */}
        <line x1="144" y1="275" x2="144" y2="285" stroke="#94a3b8" strokeWidth="1.5" />
        <line x1="138" y1="275" x2="150" y2="275" stroke="#94a3b8" strokeWidth="1.5" />

        {/* === EV in garage/driveway === */}
        {/* Car body */}
        <path d="M95,395 Q95,385 110,385 L165,385 Q175,385 175,390 L175,405 Q175,410 170,410 L100,410 Q95,410 95,405 Z"
          fill="#374151" stroke="#4b5563" strokeWidth="1" />
        {/* Car roof */}
        <path d="M110,385 L120,372 L155,372 L165,385"
          fill="#374151" stroke="#4b5563" strokeWidth="1" />
        {/* Windows */}
        <path d="M122,384 L128,374 L152,374 L158,384" fill="#1e293b" stroke="#4b5563" strokeWidth="0.5" />
        {/* Wheels */}
        <circle cx="115" cy="410" r="6" fill="#1e293b" stroke="#4b5563" strokeWidth="1" />
        <circle cx="160" cy="410" r="6" fill="#1e293b" stroke="#4b5563" strokeWidth="1" />
        {/* EV charge indicator */}
        {ev > 10 && (
          <circle cx="175" cy="395" r="4" fill="#a78bfa" fillOpacity="0.8">
            <animate attributeName="fillOpacity" values="0.8;0.3;0.8" dur="1.5s" repeatCount="indefinite" />
          </circle>
        )}

        {/* === GRID (power pole on right) === */}
        {/* Pole */}
        <rect x="518" y="195" width="6" height="170" rx="1" fill="#4b5563" />
        {/* Cross beam */}
        <rect x="505" y="205" width="32" height="4" rx="1" fill="#4b5563" />
        {/* Wires */}
        <line x1="505" y1="207" x2="490" y2="230" stroke="#6b7280" strokeWidth="1" />
        <line x1="537" y1="207" x2="552" y2="230" stroke="#6b7280" strokeWidth="1" />
        {/* Insulators */}
        <circle cx="505" cy="207" r="3" fill="#6b7280" />
        <circle cx="537" cy="207" r="3" fill="#6b7280" />
        {/* Wire to house */}
        <path d="M490,230 Q460,245 430,255" stroke="#6b7280" strokeWidth="1" fill="none" />

        {/* === ANIMATED FLOW LINES === */}
        {flows.filter(f => f.active && f.watts > 10).map((f, i) => {
          const thickness = Math.max(1.5, Math.min(4, f.watts / 1000));
          return (
            <line
              key={i}
              x1={f.x1} y1={f.y1} x2={f.x2} y2={f.y2}
              stroke={f.color}
              strokeWidth={thickness}
              strokeDasharray="6 4"
              strokeLinecap="round"
              className="flow-line"
              opacity={0.7}
            />
          );
        })}

        {/* === GROUND LINE === */}
        <line x1="60" y1="355" x2="560" y2="355" stroke="#1e293b" strokeWidth="1" />

        {/* === LABELS === */}
        {/* SOLAR label — top center */}
        <text x="300" y="90" textAnchor="middle" className="fill-gray-500 uppercase" fontSize="10" letterSpacing="1.5" fontWeight="500">Solar</text>
        <text x="300" y="106" textAnchor="middle" fill="#facc15" fontSize="16" fontWeight="700">{formatW(solar)}</text>

        {/* HOME label — inside/above house */}
        <text x="380" y="210" textAnchor="start" className="fill-gray-500 uppercase" fontSize="10" letterSpacing="1.5" fontWeight="500">Home</text>
        <text x="380" y="226" textAnchor="start" fill="#60a5fa" fontSize="16" fontWeight="700">{formatW(home)}</text>

        {/* POWERWALL label — left of powerwall */}
        <text x="144" y="340" textAnchor="middle" className="fill-gray-500 uppercase" fontSize="9" letterSpacing="1.2" fontWeight="500">Powerwall</text>
        <text x="144" y="356" textAnchor="middle" fill="#34d399" fontSize="14" fontWeight="700">
          {formatW(isCharging ? batCharge : batDischarge)}
          {isCharging ? " ▲" : isDischarging ? " ▼" : ""}
        </text>
        <text x="144" y="370" textAnchor="middle" fill={batteryPct >= 60 ? "#22c55e" : batteryPct >= 20 ? "#eab308" : "#ef4444"} fontSize="12" fontWeight="600">
          {batteryPct}%
        </text>

        {/* GRID label — right side */}
        <text x="521" y="390" textAnchor="middle" className="fill-gray-500 uppercase" fontSize="10" letterSpacing="1.5" fontWeight="500">Grid</text>
        <text x="521" y="406" textAnchor="middle" fill={isExporting ? "#fb923c" : "#f87171"} fontSize="16" fontWeight="700">
          {isExporting ? formatW(gridExport) : formatW(gridImport)}
        </text>
        {(gridImport > 10 || isExporting) && (
          <text x="521" y="420" textAnchor="middle" className="fill-gray-500" fontSize="9">
            {isExporting ? "exporting" : "importing"}
          </text>
        )}

        {/* EV label — below car */}
        <text x="135" y="432" textAnchor="middle" className="fill-gray-500 uppercase" fontSize="9" letterSpacing="1.2" fontWeight="500">Electric Vehicle</text>
        <text x="135" y="448" textAnchor="middle" fill="#a78bfa" fontSize="14" fontWeight="700">{formatW(ev)}</text>
      </svg>
    </div>
  );
}
