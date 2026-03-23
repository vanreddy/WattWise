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

// SVG icon paths (16x16 viewBox)
const NODE_ICONS: Record<string, string> = {
  Solar: "M8 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1A.5.5 0 0 1 8 1zm3.7 2.3a.5.5 0 0 1 0 .7l-.7.7a.5.5 0 1 1-.7-.7l.7-.7a.5.5 0 0 1 .7 0zM14 8a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1 0-1h1A.5.5 0 0 1 14 8zM4.3 3.3a.5.5 0 0 1 .7 0l.7.7a.5.5 0 0 1-.7.7l-.7-.7a.5.5 0 0 1 0-.7zM3.5 8a.5.5 0 0 0-.5-.5H2a.5.5 0 0 0 0 1h1a.5.5 0 0 0 .5-.5zm8.5 3a4 4 0 1 1-8 0 4 4 0 0 1 8 0z",
  "Grid Import": "M13 2.5a1.5 1.5 0 0 1 3 0v11a1.5 1.5 0 0 1-3 0v-11zm-5 2a1.5 1.5 0 0 1 3 0v9a1.5 1.5 0 0 1-3 0v-9zm-5 3a1.5 1.5 0 0 1 3 0v6a1.5 1.5 0 0 1-3 0v-6z",
  Powerwall: "M2 4h10v1H2V4zm0 2h10v6H2V6zm1 1v4h8V7H3zm8-5h2v1h1v2h-1v7h1v2h-1v1h-2v-1H3v1H1v-2h1V5H1V3h1V2h1z",
  Home: "M8 1l7 5.5V14a1 1 0 0 1-1 1h-4v-4H6v4H2a1 1 0 0 1-1-1V6.5L8 1z",
  EV: "M4 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2H4zm1 2h6v4H5V3zm0 6h2v2H5V9zm4 0h2v2H9V9z",
  "Grid Export": "M13 2.5a1.5 1.5 0 0 1 3 0v11a1.5 1.5 0 0 1-3 0v-11zm-5 2a1.5 1.5 0 0 1 3 0v9a1.5 1.5 0 0 1-3 0v-9zm-5 3a1.5 1.5 0 0 1 3 0v6a1.5 1.5 0 0 1-3 0v-6z",
};

function formatW(w: number): string {
  return `${(w / 1000).toFixed(1)} kW`;
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

// Horizontal layout: sources on left, consumption on right
interface NodeLayout {
  label: string;
  total: number;
  y: number;
  height: number;
  color: string;
  side: "left" | "right";
}

const CHART_W = 600;
const CHART_H = 350;
const NODE_W = 14;
const LEFT_X = 110;
const RIGHT_X = CHART_W - 110;
const NODE_GAP = 14;
const MIN_NODE_H = 30;

export default function LiveSankeyChart({ current }: { current: CurrentPower }) {
  const flows = useMemo(() => computeLiveFlows(current), [current]);

  if (flows.length === 0) {
    return (
      <div className="bg-gray-900 rounded-xl p-3 sm:p-4 border border-gray-800">
        <div className="flex items-center justify-center h-[250px] sm:h-[350px] text-gray-600 text-sm">
          No active energy flow
        </div>
      </div>
    );
  }

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
    const availH = CHART_H - 60 - totalGap;
    const result = new Map<string, NodeLayout>();

    let y = 30;
    for (const [label, total] of entries) {
      const height = Math.max(MIN_NODE_H, (total / totalValue) * availH);
      result.set(label, { label, total, y, height, color: NODE_COLORS[label] || "#6b7280", side });
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

  const renderNodes = (info: Map<string, NodeLayout>, x: number) =>
    [...info.values()].map((n) => {
      const iconPath = NODE_ICONS[n.label];
      const isLeft = n.side === "left";
      const textX = isLeft ? x - 8 : x + NODE_W + 8;
      const anchor = isLeft ? "end" : "start";
      const iconX = isLeft ? x - 22 : x + NODE_W + 8;
      const centerY = n.y + n.height / 2;
      return (
        <g key={n.label}>
          <rect x={x} y={n.y} width={NODE_W} height={n.height} rx={4} fill={n.color} fillOpacity={0.8} />
          {iconPath && (
            <g transform={`translate(${iconX}, ${centerY - 20})`}>
              <path d={iconPath} fill={n.color} fillOpacity={0.7} transform="scale(0.875)" />
            </g>
          )}
          <text x={textX} y={centerY - 3} textAnchor={anchor} fill={n.color} className="font-semibold" fontSize={11}>
            {n.label}
          </text>
          <text x={textX} y={centerY + 11} textAnchor={anchor} fill={n.color} className="font-semibold" fontSize={11}>
            {formatW(n.total)}
          </text>
        </g>
      );
    });

  return (
    <div className="bg-gray-900 rounded-xl p-3 sm:p-4 border border-gray-800">
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-[250px] sm:h-[350px]">
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <text x={LEFT_X + NODE_W / 2} y={18} textAnchor="middle" className="fill-gray-600 font-medium" fontSize={10} letterSpacing={1}>SOURCES</text>
        <text x={RIGHT_X + NODE_W / 2} y={18} textAnchor="middle" className="fill-gray-600 font-medium" fontSize={10} letterSpacing={1}>CONSUMPTION</text>
        {flowPaths}
        {renderNodes(leftInfo, LEFT_X)}
        {renderNodes(rightInfo, RIGHT_X)}
      </svg>
    </div>
  );
}
