"use client";

import { useMemo } from "react";
import { GitBranch } from "lucide-react";
import type { HourlyBucket, DailySummary, SankeyFlows } from "@/lib/api";

interface Flow {
  from: string;
  to: string;
  value: number;
  color: string;
}

interface NodeInfo {
  label: string;
  total: number;
  x: number;
  width: number;
  color: string;
  side: "top" | "bottom";
}

const CHART_W = 700;
const CHART_H = 420;
const NODE_H = 14;
const TOP_Y = 50;
const BOT_Y = CHART_H - 50;
const NODE_GAP = 10;
const MIN_NODE_W = 30;

function formatKwh(v: number): string {
  if (v >= 100) return `${Math.round(v)} kWh`;
  if (v >= 10) return `${v.toFixed(1)} kWh`;
  return `${v.toFixed(2)} kWh`;
}

/**
 * Compute energy flow totals from hourly data.
 */
function computeFlowsFromHourly(data: HourlyBucket[]): Flow[] {
  const flowTotals = new Map<string, number>();
  const addTo = (key: string, val: number) => {
    if (val > 0) flowTotals.set(key, (flowTotals.get(key) || 0) + val);
  };

  for (const d of data) {
    const solar = Math.max(0, d.solar_w_avg) / 1000;
    const imp = Math.max(0, d.grid_w_avg) / 1000;
    const exp = Math.max(0, -d.grid_w_avg) / 1000;
    const batDis = Math.max(0, d.battery_w_avg) / 1000;
    const batChg = Math.max(0, -d.battery_w_avg) / 1000;
    const home = Math.max(0, (d.home_w_avg - d.vehicle_w_avg)) / 1000;
    const ev = Math.max(0, d.vehicle_w_avg) / 1000;

    const totalSrc = solar + imp + batDis;
    if (totalSrc === 0) continue;

    const homePlusEv = home + ev;
    const solarToLoad = Math.min(solar, homePlusEv);
    const homeRatio = homePlusEv > 0 ? home / homePlusEv : 0;
    addTo("Solar\u2192Home", solarToLoad * homeRatio);
    addTo("Solar\u2192EV", solarToLoad * (1 - homeRatio));

    let solarLeft = solar - solarToLoad;
    const solarToBat = Math.min(batChg, solarLeft);
    addTo("Solar\u2192Battery", solarToBat);
    solarLeft -= solarToBat;
    addTo("Solar\u2192Grid Export", Math.min(exp, solarLeft));
    const solarToExp = Math.min(exp, solarLeft);

    const remainHome = Math.max(0, home - solarToLoad * homeRatio);
    const remainEv = Math.max(0, ev - solarToLoad * (1 - homeRatio));
    const remainDemand = remainHome + remainEv;
    const batToLoad = Math.min(batDis, remainDemand);
    const demandRatio = remainDemand > 0 ? remainHome / remainDemand : 0;
    addTo("Powerwall\u2192Home", batToLoad * demandRatio);
    addTo("Powerwall\u2192EV", batToLoad * (1 - demandRatio));
    const batLeft = batDis - batToLoad;
    const remainExp = Math.max(0, exp - solarToExp);
    addTo("Powerwall\u2192Grid Export", Math.min(batLeft, remainExp));

    const remainHome2 = Math.max(0, remainHome - batToLoad * demandRatio);
    const remainEv2 = Math.max(0, remainEv - batToLoad * (1 - demandRatio));
    addTo("Grid Import\u2192Home", remainHome2);
    addTo("Grid Import\u2192EV", remainEv2);
    const gridToLoad = remainHome2 + remainEv2;
    const gridLeft = imp - gridToLoad;
    const remainBatChg = Math.max(0, batChg - solarToBat);
    addTo("Grid Import\u2192Battery", Math.min(gridLeft, remainBatChg));
  }

  const flows: Flow[] = [];
  const colorMap: Record<string, string> = {
    "Solar": "#facc15",
    "Grid Import": "#f87171",
    "Powerwall": "#34d399",
  };

  for (const [key, value] of flowTotals) {
    if (value < 0.01) continue;
    const [from, to] = key.split("\u2192");
    flows.push({ from, to, value: Math.round(value * 100) / 100, color: colorMap[from] || "#6b7280" });
  }

  return flows;
}

function computeFlowsFromDaily(data: DailySummary[]): Flow[] {
  let solarTotal = 0;
  let importTotal = 0;
  let exportTotal = 0;
  let evTotal = 0;

  for (const d of data) {
    solarTotal += d.solar_generated_kwh;
    importTotal += d.total_import_kwh;
    exportTotal += d.total_export_kwh;
    evTotal += d.ev_kwh;
  }

  const selfConsumed = data.reduce((s, d) => s + d.solar_self_consumed_kwh, 0);

  const flows: Flow[] = [];
  const addFlow = (from: string, to: string, value: number, color: string) => {
    if (value > 0.01) flows.push({ from, to, value: Math.round(value * 100) / 100, color });
  };

  const solarToExport = exportTotal;
  const solarToHome = Math.max(0, selfConsumed - evTotal);
  const solarToEv = Math.min(evTotal, selfConsumed);

  addFlow("Solar", "Home", solarToHome, "#facc15");
  addFlow("Solar", "EV", solarToEv, "#facc15");
  addFlow("Solar", "Grid Export", solarToExport, "#facc15");

  const gridToEv = Math.max(0, evTotal - solarToEv);
  const gridToHome = Math.max(0, importTotal - gridToEv);
  addFlow("Grid Import", "Home", gridToHome, "#f87171");
  addFlow("Grid Import", "EV", gridToEv, "#f87171");

  return flows;
}

function convertSankeyFlowsToFlows(sf: SankeyFlows): Flow[] {
  const mapping: [keyof SankeyFlows, string, string, string][] = [
    ["solar_to_home", "Solar", "Home", "#facc15"],
    ["solar_to_battery", "Solar", "Battery", "#facc15"],
    ["solar_to_grid", "Solar", "Grid Export", "#facc15"],
    ["battery_to_home", "Powerwall", "Home", "#34d399"],
    ["battery_to_grid", "Powerwall", "Grid Export", "#34d399"],
    ["grid_to_home", "Grid Import", "Home", "#f87171"],
    ["grid_to_battery", "Grid Import", "Battery", "#f87171"],
  ];
  return mapping
    .filter(([key]) => sf[key] >= 0.01)
    .map(([key, from, to, color]) => ({ from, to, value: sf[key], color }));
}

function renderSankey(flows: Flow[]) {
  if (flows.length === 0) {
    return (
      <div className="flex items-center justify-center h-[320px] sm:h-[420px] text-gray-500 text-sm">
        No energy flow data for this period
      </div>
    );
  }

  // Compute node totals
  const topNodes = new Map<string, number>();
  const botNodes = new Map<string, number>();

  for (const f of flows) {
    topNodes.set(f.from, (topNodes.get(f.from) || 0) + f.value);
    botNodes.set(f.to, (botNodes.get(f.to) || 0) + f.value);
  }

  const nodeColors: Record<string, string> = {
    Solar: "#facc15",
    "Grid Import": "#f87171",
    Powerwall: "#34d399",
    Home: "#60a5fa",
    EV: "#a78bfa",
    Battery: "#2dd4bf",
    "Grid Export": "#fb923c",
  };

  // Layout nodes horizontally
  const layoutNodes = (
    nodeMap: Map<string, number>,
    y: number,
    side: "top" | "bottom"
  ): Map<string, NodeInfo> => {
    const entries = [...nodeMap.entries()].sort(([, a], [, b]) => b - a);
    const totalValue = entries.reduce((s, [, v]) => s + v, 0);
    const totalGap = (entries.length - 1) * NODE_GAP;
    const availW = CHART_W - 100 - totalGap;
    const result = new Map<string, NodeInfo>();

    let x = 50;
    for (const [label, total] of entries) {
      const width = Math.max(MIN_NODE_W, (total / totalValue) * availW);
      result.set(label, {
        label,
        total,
        x,
        width,
        color: nodeColors[label] || "#6b7280",
        side,
      });
      x += width + NODE_GAP;
    }

    return result;
  };

  const topInfo = layoutNodes(topNodes, TOP_Y, "top");
  const botInfo = layoutNodes(botNodes, BOT_Y, "bottom");

  // Track cumulative offsets for stacking flows within each node
  const topOffsets = new Map<string, number>();
  const botOffsets = new Map<string, number>();
  for (const [k, v] of topInfo) topOffsets.set(k, v.x);
  for (const [k, v] of botInfo) botOffsets.set(k, v.x);

  // Build flow paths (vertical: top → bottom)
  const flowPaths = flows.map((f, i) => {
    const top = topInfo.get(f.from)!;
    const bot = botInfo.get(f.to)!;

    const topX = topOffsets.get(f.from)!;
    const botX = botOffsets.get(f.to)!;

    const topW = (f.value / top.total) * top.width;
    const botW = (f.value / bot.total) * bot.width;

    topOffsets.set(f.from, topX + topW);
    botOffsets.set(f.to, botX + botW);

    const y0 = TOP_Y + NODE_H;
    const y1 = BOT_Y;
    const cy = (y0 + y1) / 2;

    const d = `
      M ${topX} ${y0}
      C ${topX} ${cy}, ${botX} ${cy}, ${botX} ${y1}
      L ${botX + botW} ${y1}
      C ${botX + botW} ${cy}, ${topX + topW} ${cy}, ${topX + topW} ${y0}
      Z
    `;

    return (
      <path
        key={i}
        d={d}
        fill={f.color}
        fillOpacity={0.25}
        stroke={f.color}
        strokeOpacity={0.5}
        strokeWidth={0.5}
      >
        <title>{`${f.from} \u2192 ${f.to}: ${formatKwh(f.value)}`}</title>
      </path>
    );
  });

  // Render nodes
  const renderNodes = (info: Map<string, NodeInfo>, y: number) =>
    [...info.values()].map((n) => (
      <g key={n.label}>
        <rect
          x={n.x}
          y={y}
          width={n.width}
          height={NODE_H}
          rx={4}
          fill={n.color}
          fillOpacity={0.8}
        />
        <text
          x={n.x + n.width / 2}
          y={n.side === "top" ? y - 16 : y + NODE_H + 14}
          textAnchor="middle"
          className="text-[11px] fill-gray-300 font-medium"
        >
          {n.label}
        </text>
        <text
          x={n.x + n.width / 2}
          y={n.side === "top" ? y - 4 : y + NODE_H + 26}
          textAnchor="middle"
          className="text-[10px] fill-gray-500"
        >
          {formatKwh(n.total)}
        </text>
      </g>
    ));

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-[320px] sm:h-[420px]">
      {flowPaths}
      {renderNodes(topInfo, TOP_Y)}
      {renderNodes(botInfo, BOT_Y)}
    </svg>
  );
}

interface Props {
  hourlyData: HourlyBucket[];
  dailyData: DailySummary[];
  days: number;
  sankeyFlows?: SankeyFlows | null;
}

export default function SankeyChart({ hourlyData, dailyData, days, sankeyFlows }: Props) {
  const totalEnergy = useMemo(() => {
    if (hourlyData.length > 0) {
      let total = 0;
      for (const d of hourlyData) {
        total += (Math.max(0, d.solar_w_avg) + Math.max(0, d.grid_w_avg) + Math.max(0, d.battery_w_avg)) / 1000;
      }
      return total;
    }
    if (dailyData.length > 0) {
      return dailyData.reduce((s, d) => s + d.solar_generated_kwh + d.total_import_kwh, 0);
    }
    return 0;
  }, [hourlyData, dailyData]);

  const flows = useMemo(() => {
    if (sankeyFlows) {
      return convertSankeyFlowsToFlows(sankeyFlows);
    }
    if (hourlyData.length > 0) {
      return computeFlowsFromHourly(hourlyData);
    }
    if (dailyData.length > 0) {
      return computeFlowsFromDaily(dailyData);
    }
    return [];
  }, [sankeyFlows, hourlyData, dailyData]);

  const title = days === 1 ? "Energy Flow" : `Energy Flow (${days} Days)`;

  return (
    <div className="bg-gray-900 rounded-xl p-3 sm:p-4 border border-gray-800">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 mb-3">
        <h2 className="text-sm font-semibold text-gray-400 flex items-center gap-1.5">
          <GitBranch size={14} className="text-purple-400" />
          {title}
        </h2>
        {flows.length > 0 && (
          <div className="flex gap-3 sm:gap-4 text-[10px]">
            <span className="text-emerald-400">Sources: {formatKwh(totalEnergy)}</span>
            <span className="text-blue-400">Consumption: {formatKwh(totalEnergy)}</span>
          </div>
        )}
      </div>
      {renderSankey(flows)}
    </div>
  );
}
