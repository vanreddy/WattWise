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

const CHART_W = 700;
const CHART_H = 440;
const NODE_H = 14;
const TOP_Y = 70;
const BOTTOM_Y = CHART_H - 70;
const NODE_GAP = 12;
const MIN_NODE_W = 40;

const nodeColors: Record<string, string> = {
  Solar: "#facc15",
  "Grid Import": "#f87171",
  "Powerwall Discharge": "#34d399",
  Home: "#60a5fa",
  EV: "#a78bfa",
  "Powerwall Charge": "#2dd4bf",
  "Grid Export": "#fb923c",
};

// SVG icon paths (16x16 viewBox)
const NODE_ICONS: Record<string, string> = {
  Solar: "M8 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-1 0v-1A.5.5 0 0 1 8 1zm3.7 2.3a.5.5 0 0 1 0 .7l-.7.7a.5.5 0 1 1-.7-.7l.7-.7a.5.5 0 0 1 .7 0zM14 8a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1 0-1h1A.5.5 0 0 1 14 8zM4.3 3.3a.5.5 0 0 1 .7 0l.7.7a.5.5 0 0 1-.7.7l-.7-.7a.5.5 0 0 1 0-.7zM3.5 8a.5.5 0 0 0-.5-.5H2a.5.5 0 0 0 0 1h1a.5.5 0 0 0 .5-.5zm8.5 3a4 4 0 1 1-8 0 4 4 0 0 1 8 0z",
  "Grid Import": "M13 2.5a1.5 1.5 0 0 1 3 0v11a1.5 1.5 0 0 1-3 0v-11zm-5 2a1.5 1.5 0 0 1 3 0v9a1.5 1.5 0 0 1-3 0v-9zm-5 3a1.5 1.5 0 0 1 3 0v6a1.5 1.5 0 0 1-3 0v-6z",
  "Powerwall Discharge": "M2 4h10v1H2V4zm0 2h10v6H2V6zm1 1v4h8V7H3zm8-5h2v1h1v2h-1v7h1v2h-1v1h-2v-1H3v1H1v-2h1V5H1V3h1V2h1z",
  "Powerwall Charge": "M2 4h10v1H2V4zm0 2h10v6H2V6zm1 1v4h8V7H3zm8-5h2v1h1v2h-1v7h1v2h-1v1h-2v-1H3v1H1v-2h1V5H1V3h1V2h1z",
  Home: "M8 1l7 5.5V14a1 1 0 0 1-1 1h-4v-4H6v4H2a1 1 0 0 1-1-1V6.5L8 1z",
  EV: "M4 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2H4zm1 2h6v4H5V3zm0 6h2v2H5V9zm4 0h2v2H9V9z",
  "Grid Export": "M13 2.5a1.5 1.5 0 0 1 3 0v11a1.5 1.5 0 0 1-3 0v-11zm-5 2a1.5 1.5 0 0 1 3 0v9a1.5 1.5 0 0 1-3 0v-9zm-5 3a1.5 1.5 0 0 1 3 0v6a1.5 1.5 0 0 1-3 0v-6z",
};

function formatKwh(v: number): string {
  return `${v.toFixed(1)} kWh`;
}

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
    addTo("Solar→Home", solarToLoad * homeRatio);
    addTo("Solar→EV", solarToLoad * (1 - homeRatio));

    let solarLeft = solar - solarToLoad;
    const solarToBat = Math.min(batChg, solarLeft);
    addTo("Solar→Powerwall Charge", solarToBat);
    solarLeft -= solarToBat;
    addTo("Solar→Grid Export", Math.min(exp, solarLeft));
    const solarToExp = Math.min(exp, solarLeft);

    const remainHome = Math.max(0, home - solarToLoad * homeRatio);
    const remainEv = Math.max(0, ev - solarToLoad * (1 - homeRatio));
    const remainDemand = remainHome + remainEv;
    const batToLoad = Math.min(batDis, remainDemand);
    const demandRatio = remainDemand > 0 ? remainHome / remainDemand : 0;
    addTo("Powerwall Discharge→Home", batToLoad * demandRatio);
    addTo("Powerwall Discharge→EV", batToLoad * (1 - demandRatio));
    const batLeft = batDis - batToLoad;
    const remainExp = Math.max(0, exp - solarToExp);
    addTo("Powerwall Discharge→Grid Export", Math.min(batLeft, remainExp));

    const remainHome2 = Math.max(0, remainHome - batToLoad * demandRatio);
    const remainEv2 = Math.max(0, remainEv - batToLoad * (1 - demandRatio));
    addTo("Grid Import→Home", remainHome2);
    addTo("Grid Import→EV", remainEv2);
    const gridToLoad = remainHome2 + remainEv2;
    const gridLeft = imp - gridToLoad;
    const remainBatChg = Math.max(0, batChg - solarToBat);
    addTo("Grid Import→Powerwall Charge", Math.min(gridLeft, remainBatChg));
  }

  const flows: Flow[] = [];
  const colorMap: Record<string, string> = {
    "Solar": "#facc15",
    "Grid Import": "#f87171",
    "Powerwall Discharge": "#34d399",
  };

  for (const [key, value] of flowTotals) {
    if (value < 0.01) continue;
    const [from, to] = key.split("→");
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
    ["solar_to_battery", "Solar", "Powerwall Charge", "#facc15"],
    ["solar_to_grid", "Solar", "Grid Export", "#facc15"],
    ["battery_to_home", "Powerwall Discharge", "Home", "#34d399"],
    ["battery_to_grid", "Powerwall Discharge", "Grid Export", "#34d399"],
    ["grid_to_home", "Grid Import", "Home", "#f87171"],
    ["grid_to_battery", "Grid Import", "Powerwall Charge", "#f87171"],
  ];
  return mapping
    .filter(([key]) => sf[key] >= 0.01)
    .map(([key, from, to, color]) => ({ from, to, value: sf[key], color }));
}

interface NodeLayout {
  label: string;
  total: number;
  x: number;
  width: number;
  color: string;
  row: "top" | "bottom";
}

function renderSankey(flows: Flow[]) {
  if (flows.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] sm:h-[400px] text-gray-500 text-sm">
        No energy flow data for this period
      </div>
    );
  }

  const topNodes = new Map<string, number>();
  const bottomNodes = new Map<string, number>();

  for (const f of flows) {
    topNodes.set(f.from, (topNodes.get(f.from) || 0) + f.value);
    bottomNodes.set(f.to, (bottomNodes.get(f.to) || 0) + f.value);
  }

  const layoutNodes = (
    nodeMap: Map<string, number>,
    row: "top" | "bottom"
  ): Map<string, NodeLayout> => {
    const entries = [...nodeMap.entries()].sort(([, a], [, b]) => b - a);
    const totalValue = entries.reduce((s, [, v]) => s + v, 0);
    const totalGap = (entries.length - 1) * NODE_GAP;
    const availW = CHART_W - 80 - totalGap;
    const result = new Map<string, NodeLayout>();

    let x = 40;
    for (const [label, total] of entries) {
      const width = Math.max(MIN_NODE_W, (total / totalValue) * availW);
      result.set(label, { label, total, x, width, color: nodeColors[label] || "#6b7280", row });
      x += width + NODE_GAP;
    }
    return result;
  };

  const topInfo = layoutNodes(topNodes, "top");
  const bottomInfo = layoutNodes(bottomNodes, "bottom");

  const topOffsets = new Map<string, number>();
  const bottomOffsets = new Map<string, number>();
  for (const [k, v] of topInfo) topOffsets.set(k, v.x);
  for (const [k, v] of bottomInfo) bottomOffsets.set(k, v.x);

  const flowPaths = flows.map((f, i) => {
    const top = topInfo.get(f.from)!;
    const bottom = bottomInfo.get(f.to)!;

    const topX = topOffsets.get(f.from)!;
    const bottomX = bottomOffsets.get(f.to)!;

    const topW = (f.value / top.total) * top.width;
    const bottomW = (f.value / bottom.total) * bottom.width;

    topOffsets.set(f.from, topX + topW);
    bottomOffsets.set(f.to, bottomX + bottomW);

    const y0 = TOP_Y + NODE_H;
    const y1 = BOTTOM_Y;
    const cy = (y0 + y1) / 2;

    const d = `
      M ${topX} ${y0}
      C ${topX} ${cy}, ${bottomX} ${cy}, ${bottomX} ${y1}
      L ${bottomX + bottomW} ${y1}
      C ${bottomX + bottomW} ${cy}, ${topX + topW} ${cy}, ${topX + topW} ${y0}
      Z
    `;

    return (
      <path
        key={i}
        d={d}
        fill={f.color}
        fillOpacity={0.2}
        stroke={f.color}
        strokeOpacity={0.35}
        strokeWidth={0.5}
      >
        <title>{`${f.from} → ${f.to}: ${formatKwh(f.value)}`}</title>
      </path>
    );
  });

  const renderNodes = (info: Map<string, NodeLayout>, y: number) =>
    [...info.values()].map((n) => {
      const iconPath = NODE_ICONS[n.label];
      const labelY = n.row === "top" ? y - 28 : y + NODE_H + 18;
      const valueY = n.row === "top" ? y - 14 : y + NODE_H + 32;
      const iconY = n.row === "top" ? y - 44 : y + NODE_H + 38;
      return (
        <g key={n.label}>
          <rect x={n.x} y={y} width={n.width} height={NODE_H} rx={4} fill={n.color} fillOpacity={0.8} />
          {iconPath && (
            <g transform={`translate(${n.x + n.width / 2 - 7}, ${iconY})`}>
              <path d={iconPath} fill={n.color} fillOpacity={0.7} transform="scale(0.875)" />
            </g>
          )}
          <text x={n.x + n.width / 2} y={labelY} textAnchor="middle" fill={n.color} className="font-semibold" fontSize={12}>
            {n.label}
          </text>
          <text x={n.x + n.width / 2} y={valueY} textAnchor="middle" fill={n.color} className="font-semibold" fontSize={12}>
            {formatKwh(n.total)}
          </text>
        </g>
      );
    });

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-[300px] sm:h-[400px]">
      <text x={CHART_W / 2} y={16} textAnchor="middle" className="fill-gray-600 font-medium" fontSize={11} letterSpacing={1}>SOURCES</text>
      <text x={CHART_W / 2} y={CHART_H - 4} textAnchor="middle" className="fill-gray-600 font-medium" fontSize={11} letterSpacing={1}>CONSUMPTION</text>
      {flowPaths}
      {renderNodes(topInfo, TOP_Y)}
      {renderNodes(bottomInfo, BOTTOM_Y)}
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
