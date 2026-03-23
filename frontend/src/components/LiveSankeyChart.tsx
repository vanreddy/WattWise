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
  "Powerwall": "#34d399",
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

  const totalDemand = home + ev + batCharge + gridExport;
  if (totalDemand === 0 && solar === 0 && gridImport === 0) return flows;

  // Solar allocation
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

  // Battery discharge
  const remainHome = Math.max(0, home - solarToLoad * homeRatio);
  const remainEv = Math.max(0, ev - solarToLoad * (1 - homeRatio));
  const remainDemand = remainHome + remainEv;
  const batToLoad = Math.min(batDischarge, remainDemand);
  const dRatio = remainDemand > 0 ? remainHome / remainDemand : 0;
  if (batToLoad * dRatio > 10) flows.push({ from: "Powerwall", to: "Home", watts: batToLoad * dRatio, color: "#34d399" });
  if (batToLoad * (1 - dRatio) > 10) flows.push({ from: "Powerwall", to: "EV", watts: batToLoad * (1 - dRatio), color: "#34d399" });

  // Grid import
  const remainHome2 = Math.max(0, remainHome - batToLoad * dRatio);
  const remainEv2 = Math.max(0, remainEv - batToLoad * (1 - dRatio));
  if (remainHome2 > 10) flows.push({ from: "Grid Import", to: "Home", watts: remainHome2, color: "#f87171" });
  if (remainEv2 > 10) flows.push({ from: "Grid Import", to: "EV", watts: remainEv2, color: "#f87171" });

  const gridLeft = gridImport - remainHome2 - remainEv2;
  const remainBatChg = Math.max(0, batCharge - solarToBat);
  if (gridLeft > 10 && remainBatChg > 10) flows.push({ from: "Grid Import", to: "Powerwall", watts: Math.min(gridLeft, remainBatChg), color: "#f87171" });

  return flows;
}

interface NodeLayout {
  label: string;
  total: number;
  y: number;
  height: number;
  color: string;
  side: "left" | "right";
}

const CHART_W = 600;
const CHART_H = 300;
const NODE_W = 12;
const LEFT_X = 60;
const RIGHT_X = CHART_W - 60;
const NODE_GAP = 8;
const MIN_NODE_H = 20;

export default function LiveSankeyChart({ current }: { current: CurrentPower }) {
  const flows = useMemo(() => computeLiveFlows(current), [current]);

  if (flows.length === 0) {
    return (
      <div className="bg-gray-900 rounded-xl p-3 sm:p-4 border border-gray-800">
        <div className="flex items-center justify-center h-[200px] sm:h-[280px] text-gray-600 text-sm">
          No active energy flow
        </div>
      </div>
    );
  }

  // Compute node totals
  const leftNodes = new Map<string, number>();
  const rightNodes = new Map<string, number>();
  for (const f of flows) {
    leftNodes.set(f.from, (leftNodes.get(f.from) || 0) + f.watts);
    rightNodes.set(f.to, (rightNodes.get(f.to) || 0) + f.watts);
  }

  const layoutNodes = (
    nodeMap: Map<string, number>,
    side: "left" | "right"
  ): Map<string, NodeLayout> => {
    const entries = [...nodeMap.entries()].sort(([, a], [, b]) => b - a);
    const totalValue = entries.reduce((s, [, v]) => s + v, 0);
    const totalGap = (entries.length - 1) * NODE_GAP;
    const availH = CHART_H - 40 - totalGap;
    const result = new Map<string, NodeLayout>();

    let y = 20;
    for (const [label, total] of entries) {
      const height = Math.max(MIN_NODE_H, (total / totalValue) * availH);
      result.set(label, {
        label,
        total,
        y,
        height,
        color: NODE_COLORS[label] || "#6b7280",
        side,
      });
      y += height + NODE_GAP;
    }
    return result;
  };

  const leftInfo = layoutNodes(leftNodes, "left");
  const rightInfo = layoutNodes(rightNodes, "right");

  const leftOffsets = new Map<string, number>();
  const rightOffsets = new Map<string, number>();
  for (const [k, v] of leftInfo) leftOffsets.set(k, v.y);
  for (const [k, v] of rightInfo) rightOffsets.set(k, v.y);

  // Speed factor: higher watts = faster animation
  const maxWatts = Math.max(...flows.map((f) => f.watts));

  const flowPaths = flows.map((f, i) => {
    const left = leftInfo.get(f.from)!;
    const right = rightInfo.get(f.to)!;

    const leftY = leftOffsets.get(f.from)!;
    const rightY = rightOffsets.get(f.to)!;

    const leftH = (f.watts / left.total) * left.height;
    const rightH = (f.watts / right.total) * right.height;

    leftOffsets.set(f.from, leftY + leftH);
    rightOffsets.set(f.to, rightY + rightH);

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

    // Flow line path (center of the band)
    const midLeftY = leftY + leftH / 2;
    const midRightY = rightY + rightH / 2;
    const flowLine = `M ${x0} ${midLeftY} C ${cx} ${midLeftY}, ${cx} ${midRightY}, ${x1} ${midRightY}`;

    // Animation duration: larger flows move faster
    const speed = Math.max(1, 4 - (f.watts / maxWatts) * 3);
    const bandWidth = Math.max(2, Math.min(leftH, rightH) * 0.6);

    return (
      <g key={i}>
        {/* Base flow band */}
        <path
          d={d}
          fill={f.color}
          fillOpacity={0.15}
          stroke={f.color}
          strokeOpacity={0.3}
          strokeWidth={0.5}
        />
        {/* Animated flowing particles */}
        <path
          d={flowLine}
          fill="none"
          stroke={f.color}
          strokeOpacity={0.6}
          strokeWidth={bandWidth}
          strokeDasharray="8 16"
          strokeLinecap="round"
          className="animate-flow"
          style={{
            animationDuration: `${speed}s`,
          }}
        />
        {/* Glow effect */}
        <path
          d={flowLine}
          fill="none"
          stroke={f.color}
          strokeOpacity={0.15}
          strokeWidth={bandWidth + 6}
          strokeLinecap="round"
          filter="url(#glow)"
        />
        {/* Wattage label at center */}
        <text
          x={(x0 + x1) / 2}
          y={(midLeftY + midRightY) / 2 - bandWidth / 2 - 4}
          textAnchor="middle"
          className="fill-gray-500"
          fontSize={9}
        >
          {formatW(f.watts)}
        </text>
      </g>
    );
  });

  const renderNodes = (info: Map<string, NodeLayout>, x: number) =>
    [...info.values()].map((n) => (
      <g key={n.label}>
        <rect
          x={x}
          y={n.y}
          width={NODE_W}
          height={n.height}
          rx={4}
          fill={n.color}
          fillOpacity={0.85}
        />
        <text
          x={n.side === "left" ? x - 6 : x + NODE_W + 6}
          y={n.y + n.height / 2 - 7}
          dy="0.35em"
          textAnchor={n.side === "left" ? "end" : "start"}
          fill={n.color}
          className="font-semibold"
          fontSize={12}
        >
          {n.label}
        </text>
        <text
          x={n.side === "left" ? x - 6 : x + NODE_W + 6}
          y={n.y + n.height / 2 + 7}
          dy="0.35em"
          textAnchor={n.side === "left" ? "end" : "start"}
          className="fill-gray-500"
          fontSize={10}
        >
          {formatW(n.total)}
        </text>
      </g>
    ));

  return (
    <div className="bg-gray-900 rounded-xl p-3 sm:p-4 border border-gray-800">
      <style>{`
        @keyframes flowDash {
          from { stroke-dashoffset: 24; }
          to { stroke-dashoffset: 0; }
        }
        .animate-flow {
          animation: flowDash linear infinite;
        }
      `}</style>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-[200px] sm:h-[280px]">
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {flowPaths}
        {renderNodes(leftInfo, LEFT_X)}
        {renderNodes(rightInfo, RIGHT_X)}
      </svg>
    </div>
  );
}
