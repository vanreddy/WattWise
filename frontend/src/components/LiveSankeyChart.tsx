"use client";

import { useMemo } from "react";
import type { CurrentPower } from "@/lib/api";

interface LiveFlow {
  from: string;
  to: string;
  watts: number;
  color: string;
}

const NODE_COLORS: Record<string, string> = {
  Solar: "#facc15",
  "Grid Import": "#f87171",
  Powerwall: "#34d399",
  Home: "#60a5fa",
  EV: "#a78bfa",
  "Grid Export": "#fb923c",
};

function formatW(w: number): string {
  if (Math.abs(w) >= 1000) return `${(w / 1000).toFixed(1)} kW`;
  return `${Math.round(w)} W`;
}

function computeLiveFlows(current: CurrentPower): LiveFlow[] {
  const flows: LiveFlow[] = [];
  const solar = Math.max(0, current.solar_w);
  const gridImport = Math.max(0, current.grid_w);
  const gridExport = Math.max(0, -current.grid_w);
  const batDischarge = Math.max(0, current.battery_w);
  const batCharge = Math.max(0, -current.battery_w);
  const home = Math.max(0, current.home_w - current.vehicle_w);
  const ev = Math.max(0, current.vehicle_w);

  const homePlusEv = home + ev;
  const solarToLoad = Math.min(solar, homePlusEv);
  const homeRatio = homePlusEv > 0 ? home / homePlusEv : 0;
  if (solarToLoad * homeRatio > 10) flows.push({ from: "Solar", to: "Home", watts: solarToLoad * homeRatio, color: "#facc15" });
  if (solarToLoad * (1 - homeRatio) > 10) flows.push({ from: "Solar", to: "EV", watts: solarToLoad * (1 - homeRatio), color: "#facc15" });

  let solarLeft = solar - solarToLoad;
  const solarToBat = Math.min(batCharge, solarLeft);
  if (solarToBat > 10) flows.push({ from: "Solar", to: "Powerwall", watts: solarToBat, color: "#facc15" });
  solarLeft -= solarToBat;
  if (solarLeft > 10 && gridExport > 10) flows.push({ from: "Solar", to: "Grid Export", watts: Math.min(gridExport, solarLeft), color: "#facc15" });

  const remainHome = Math.max(0, home - solarToLoad * homeRatio);
  const remainEv = Math.max(0, ev - solarToLoad * (1 - homeRatio));
  const remainDemand = remainHome + remainEv;
  const batToLoad = Math.min(batDischarge, remainDemand);
  const dRatio = remainDemand > 0 ? remainHome / remainDemand : 0;
  if (batToLoad * dRatio > 10) flows.push({ from: "Powerwall", to: "Home", watts: batToLoad * dRatio, color: "#34d399" });
  if (batToLoad * (1 - dRatio) > 10) flows.push({ from: "Powerwall", to: "EV", watts: batToLoad * (1 - dRatio), color: "#34d399" });

  const remainHome2 = Math.max(0, remainHome - batToLoad * dRatio);
  const remainEv2 = Math.max(0, remainEv - batToLoad * (1 - dRatio));
  if (remainHome2 > 10) flows.push({ from: "Grid Import", to: "Home", watts: remainHome2, color: "#f87171" });
  if (remainEv2 > 10) flows.push({ from: "Grid Import", to: "EV", watts: remainEv2, color: "#f87171" });

  const gridLeft = gridImport - remainHome2 - remainEv2;
  const remainBatChg = Math.max(0, batCharge - solarToBat);
  if (gridLeft > 10 && remainBatChg > 10) flows.push({ from: "Grid Import", to: "Powerwall", watts: Math.min(gridLeft, remainBatChg), color: "#f87171" });

  return flows;
}

// Fixed node positions — all nodes always visible
const CHART_W = 600;
const CHART_H = 420;
const NODE_W = 14;
const LEFT_X = 130;
const RIGHT_X = CHART_W - 130;
const NODE_H = 40;

// Fixed Y positions for each node
const LEFT_NODES = ["Solar", "Powerwall", "Grid Import"] as const;
const RIGHT_NODES = ["Home", "Powerwall", "EV", "Grid Export"] as const;

function getNodeY(index: number): number {
  const startY = 45;
  const gap = 20;
  return startY + index * (NODE_H + gap);
}

export default function LiveSankeyChart({ current }: { current: CurrentPower }) {
  const flows = useMemo(() => computeLiveFlows(current), [current]);

  const solar = Math.max(0, current.solar_w);
  const gridImport = Math.max(0, current.grid_w);
  const gridExport = Math.max(0, -current.grid_w);
  const batDischarge = Math.max(0, current.battery_w);
  const batCharge = Math.max(0, -current.battery_w);
  const home = Math.max(0, current.home_w);
  const ev = Math.max(0, current.vehicle_w);
  const batteryPct = Math.round(current.battery_pct);
  const isCharging = current.battery_w < -10;
  const isDischarging = current.battery_w > 10;

  // Left node totals
  const leftTotals: Record<string, number> = {
    Solar: solar,
    Powerwall: isDischarging ? batDischarge : isCharging ? batCharge : 0,
    "Grid Import": gridImport,
  };

  // Right node totals
  const rightTotals: Record<string, number> = {
    Home: home,
    Powerwall: isCharging ? batCharge : 0,
    EV: ev,
    "Grid Export": gridExport,
  };

  // Build node position maps for flow drawing
  const leftNodeMap = new Map<string, { y: number; h: number; offset: number }>();
  const rightNodeMap = new Map<string, { y: number; h: number; offset: number }>();

  LEFT_NODES.forEach((label, i) => {
    leftNodeMap.set(label, { y: getNodeY(i), h: NODE_H, offset: 0 });
  });
  RIGHT_NODES.forEach((label, i) => {
    // Use a distinct key for right-side Powerwall to avoid collision
    const key = label === "Powerwall" ? "Powerwall_R" : label;
    rightNodeMap.set(key, { y: getNodeY(i), h: NODE_H, offset: 0 });
  });
  // Also map "Powerwall" to right side for flows that target it as consumption
  rightNodeMap.set("Powerwall", rightNodeMap.get("Powerwall_R")!);

  const maxWatts = flows.length > 0 ? Math.max(...flows.map((f) => f.watts)) : 1;

  const flowPaths = flows.map((f, i) => {
    const left = leftNodeMap.get(f.from);
    const right = rightNodeMap.get(f.to);
    if (!left || !right) return null;

    const leftY = left.y + left.offset;
    const rightY = right.y + right.offset;

    // Proportion of this flow relative to total node
    const leftTotal = leftTotals[f.from] || 1;
    const rightTotal = rightTotals[f.to] || 1;
    const leftH = Math.max(4, (f.watts / leftTotal) * NODE_H);
    const rightH = Math.max(4, (f.watts / rightTotal) * NODE_H);

    left.offset += leftH;
    right.offset += rightH;

    const x0 = LEFT_X + NODE_W;
    const x1 = RIGHT_X;
    const cx = (x0 + x1) / 2;

    const d = `
      M ${x0} ${leftY}
      C ${cx} ${leftY}, ${cx} ${rightY}, ${x1} ${rightY}
      L ${x1} ${rightY + rightH}
      C ${cx} ${rightY + rightH}, ${cx} ${leftY + leftH}, ${x0} ${leftY + leftH}
      Z
    `;

    const midLeftY = leftY + leftH / 2;
    const midRightY = rightY + rightH / 2;
    const flowLine = `M ${x0} ${midLeftY} C ${cx} ${midLeftY}, ${cx} ${midRightY}, ${x1} ${midRightY}`;

    const speed = Math.max(1.5, 5 - (f.watts / maxWatts) * 3.5);
    const gradId = `live-flow-grad-${i}`;
    const clipId = `live-flow-clip-${i}`;

    return (
      <g key={i}>
        <clipPath id={clipId}>
          <path d={d} />
        </clipPath>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={f.color} stopOpacity={0.05}>
            <animate attributeName="stop-opacity" values="0.05;0.25;0.05" dur={`${speed}s`} repeatCount="indefinite" />
          </stop>
          <stop offset="40%" stopColor={f.color} stopOpacity={0.3}>
            <animate attributeName="offset" values="0;0.5;1" dur={`${speed}s`} repeatCount="indefinite" />
            <animate attributeName="stop-opacity" values="0.08;0.35;0.08" dur={`${speed}s`} repeatCount="indefinite" />
          </stop>
          <stop offset="100%" stopColor={f.color} stopOpacity={0.05}>
            <animate attributeName="stop-opacity" values="0.05;0.2;0.05" dur={`${speed}s`} repeatCount="indefinite" />
          </stop>
        </linearGradient>

        <path d={d} fill={f.color} fillOpacity={0.07} stroke={f.color} strokeOpacity={0.15} strokeWidth={0.5} />
        <path d={d} fill={`url(#${gradId})`} stroke="none" clipPath={`url(#${clipId})`} />
        <path d={flowLine} fill="none" stroke={f.color} strokeOpacity={0.12}
          strokeWidth={Math.max(3, Math.min(leftH, rightH) * 0.3)} strokeLinecap="round" clipPath={`url(#${clipId})`} />
      </g>
    );
  });

  // Render a node (always visible)
  const renderNode = (label: string, total: number, y: number, side: "left" | "right", extra?: string) => {
    const color = NODE_COLORS[label] || "#6b7280";
    const isActive = total > 10;
    const x = side === "left" ? LEFT_X : RIGHT_X;
    const textX = side === "left" ? x - 8 : x + NODE_W + 8;
    const anchor = side === "left" ? "end" : "start";
    const centerY = y + NODE_H / 2;

    return (
      <g key={`${side}-${label}`}>
        <rect x={x} y={y} width={NODE_W} height={NODE_H} rx={4}
          fill={color} fillOpacity={isActive ? 0.8 : 0.15} />
        <text x={textX} y={centerY - (extra ? 8 : 3)} textAnchor={anchor}
          fill={color} className="font-semibold" fontSize={11}
          opacity={isActive ? 1 : 0.4}>
          {label}
        </text>
        <text x={textX} y={centerY + (extra ? 4 : 11)} textAnchor={anchor}
          fill={color} className="font-semibold" fontSize={11}
          opacity={isActive ? 1 : 0.4}>
          {formatW(total)}
        </text>
        {extra && (
          <text x={textX} y={centerY + 17} textAnchor={anchor}
            fill={color} className="font-medium" fontSize={10}
            opacity={0.7}>
            {extra}
          </text>
        )}
      </g>
    );
  };

  // Battery extra label
  const batteryExtra = `${isCharging ? "▲" : isDischarging ? "▼" : ""} ${batteryPct}%`;

  return (
    <div className="bg-gray-900 rounded-xl p-3 sm:p-4 border border-gray-800">
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-[280px] sm:h-[380px]">
        <text x={LEFT_X + NODE_W / 2} y={28} textAnchor="middle" className="fill-gray-600 font-medium" fontSize={10} letterSpacing={1}>SOURCES</text>
        <text x={RIGHT_X + NODE_W / 2} y={28} textAnchor="middle" className="fill-gray-600 font-medium" fontSize={10} letterSpacing={1}>CONSUMPTION</text>

        {flowPaths}

        {/* Left nodes — always visible */}
        {renderNode("Solar", solar, getNodeY(0), "left")}
        {renderNode("Powerwall", isDischarging ? batDischarge : isCharging ? batCharge : 0, getNodeY(1), "left", batteryExtra)}
        {renderNode("Grid Import", gridImport, getNodeY(2), "left")}

        {/* Right nodes — always visible */}
        {renderNode("Home", home, getNodeY(0), "right")}
        {renderNode("Powerwall", isCharging ? batCharge : 0, getNodeY(1), "right", batteryExtra)}
        {renderNode("EV", ev, getNodeY(2), "right")}
        {renderNode("Grid Export", gridExport, getNodeY(3), "right")}
      </svg>
    </div>
  );
}
