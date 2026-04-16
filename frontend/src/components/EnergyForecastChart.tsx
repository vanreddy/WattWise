"use client";

import { useRef, useEffect, useCallback, useMemo } from "react";
import type { OptimizerPlan, HourPlanEntry } from "@/lib/api";

/* ─── Types ─── */

interface Props {
  plan: OptimizerPlan | null;
}

/* ─── Sample data (fallback when no plan yet) ─── */

function sampleSolarKw(h: number): number {
  if (h < 6 || h > 18) return 0;
  return 8.2 * Math.exp(-0.5 * Math.pow((h - 12) / 2.8, 2));
}

function sampleLoadKw(h: number): number {
  const base = 1.4;
  if (h >= 17 && h <= 21) return base + 1.2 * Math.exp(-0.5 * Math.pow((h - 19) / 1.5, 2));
  if (h >= 7 && h <= 9) return base + 0.3 * Math.exp(-0.5 * Math.pow((h - 8) / 0.8, 2));
  return base;
}

/* ─── Smooth curve helper ─── */

function drawCardinalSpline(
  ctx: CanvasRenderingContext2D,
  points: [number, number][],
  tension = 0.3
) {
  if (points.length < 2) return;
  ctx.moveTo(points[0][0], points[0][1]);
  if (points.length === 2) {
    ctx.lineTo(points[1][0], points[1][1]);
    return;
  }
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1[0] + (p2[0] - p0[0]) * tension;
    const cp1y = p1[1] + (p2[1] - p0[1]) * tension;
    const cp2x = p2[0] - (p3[0] - p1[0]) * tension;
    const cp2y = p2[1] - (p3[1] - p1[1]) * tension;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
  }
}

/* ─── Hour formatting ─── */

function fmtHour(h: number): string {
  const hh = h % 24;
  if (hh === 0 || hh === 24) return "12am";
  if (hh === 12) return "12pm";
  return hh < 12 ? `${hh}am` : `${hh - 12}pm`;
}

/* ─── Swim lane segment type ─── */

interface SwimSegment {
  startH: number;
  endH: number;
  color: string;
}

/* ═══════════════════════════════════════════════ */
/* ═══ MAIN COMPONENT ═══════════════════════════ */
/* ═══════════════════════════════════════════════ */

export default function EnergyForecastChart({ plan }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  /* ─── Extract data from plan or use samples ─── */

  // Build lookup maps from plan.hours
  // IMPORTANT: plan hours are in UTC — convert to local time for display
  const { solarByHour, loadByHour } = useMemo(() => {
    const solar: Record<number, number> = {};
    const load: Record<number, number> = {};
    if (plan?.hours) {
      for (const h of plan.hours) {
        // plan.hours[].hour is already a local clock hour (set by backend score.py)
        solar[h.hour] = (h.solar_w ?? 0) / 1000; // watts → kW
        load[h.hour] = (h.base_load_w ?? 0) / 1000;
      }
    }
    return { solarByHour: solar, loadByHour: load };
  }, [plan]);

  const hasPlanData = plan?.hours && plan.hours.length > 0;

  const getSolarKw = useCallback(
    (h: number): number => {
      if (hasPlanData) {
        const lo = Math.floor(h), hi = Math.ceil(h) % 24;
        const loVal = solarByHour[lo] ?? 0;
        const hiVal = solarByHour[hi] ?? 0;
        // Interpolate for smooth curve between integer hours
        return loVal + (hiVal - loVal) * (h - lo);
      }
      return sampleSolarKw(h);
    },
    [hasPlanData, solarByHour]
  );

  const getLoadKw = useCallback(
    (h: number): number => {
      if (hasPlanData) {
        const lo = Math.floor(h), hi = Math.ceil(h) % 24;
        const loVal = loadByHour[lo] ?? 0;
        const hiVal = loadByHour[hi] ?? 0;
        return loVal + (hiVal - loVal) * (h - lo);
      }
      return sampleLoadKw(h);
    },
    [hasPlanData, loadByHour]
  );

  /* ─── Extract swim lane segments from plan hours ─── */
  function buildSwimLanes(hours: HourPlanEntry[]): {
    pw: SwimSegment[];
    ev: SwimSegment[];
    hvac: SwimSegment[];
  } {
    const pw: SwimSegment[] = [];
    const ev: SwimSegment[] = [];
    const hvac: SwimSegment[] = [];

    // Collapse consecutive same-action hours into segments
    function collapse(
      items: { hour: number; action: string }[],
      actionColorMap: Record<string, string>
    ): SwimSegment[] {
      const segs: SwimSegment[] = [];
      let cur: { action: string; start: number; end: number } | null = null;
      for (const item of items) {
        if (item.action === "idle" || item.action === "none" || !item.action) {
          if (cur) { segs.push({ startH: cur.start, endH: cur.end + 1, color: actionColorMap[cur.action] || "rgba(255,255,255,0.1)" }); cur = null; }
          continue;
        }
        if (cur && cur.action === item.action && item.hour === cur.end + 1) {
          cur.end = item.hour;
        } else {
          if (cur) segs.push({ startH: cur.start, endH: cur.end + 1, color: actionColorMap[cur.action] || "rgba(255,255,255,0.1)" });
          cur = { action: item.action, start: item.hour, end: item.hour };
        }
      }
      if (cur) segs.push({ startH: cur.start, endH: cur.end + 1, color: actionColorMap[cur.action] || "rgba(255,255,255,0.1)" });
      return segs;
    }

    // plan.hours[].hour is already local — no conversion needed
    const pwActions = hours.map(h => ({ hour: h.hour, action: h.pw_action })).sort((a, b) => a.hour - b.hour);
    const evActions = hours.map(h => ({ hour: h.hour, action: h.ev_action })).sort((a, b) => a.hour - b.hour);
    const hvacActions = hours.map(h => ({ hour: h.hour, action: h.hvac_action })).sort((a, b) => a.hour - b.hour);

    pw.push(
      ...collapse(pwActions, { charge: "rgba(34,197,94,0.55)", discharge: "rgba(249,115,22,0.55)" })
    );
    ev.push(
      ...collapse(evActions, { charge: "rgba(168,85,247,0.55)", recommend_charge: "rgba(168,85,247,0.35)" })
    );
    hvac.push(
      ...collapse(hvacActions, {
        precool: "rgba(59,130,246,0.55)",
        eco: "rgba(34,197,94,0.35)",
        cool: "rgba(59,130,246,0.4)",
        heat: "rgba(249,115,22,0.4)",
      })
    );

    return { pw, ev, hvac };
  }

  // Fallback swim lanes when no plan
  const defaultSwimLanes = {
    pw: [
      { startH: 9, endH: 14, color: "rgba(34,197,94,0.55)" },
      { startH: 16, endH: 21, color: "rgba(249,115,22,0.55)" },
    ],
    ev: [{ startH: 10, endH: 13, color: "rgba(168,85,247,0.55)" }],
    hvac: [{ startH: 13, endH: 16, color: "rgba(59,130,246,0.55)" }],
  };

  /* ─── Canvas draw ─── */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const dpr = window.devicePixelRatio || 1;
    const chartW = wrap.offsetWidth;
    const chartH = 195;
    canvas.width = chartW * dpr;
    canvas.height = chartH * dpr;
    canvas.style.width = chartW + "px";
    canvas.style.height = chartH + "px";

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const PAD = { top: 8, right: 8, bottom: 22, left: 34 };
    const plotW = chartW - PAD.left - PAD.right;
    const plotH = chartH - PAD.top - PAD.bottom;
    const maxKw = 9;

    const xForHour = (h: number) => PAD.left + ((h - 6) / 18) * plotW;
    const yForKw = (kw: number) => PAD.top + plotH - (kw / maxKw) * plotH;
    const baseline = yForKw(0);

    // Dense sample arrays
    const N = 200;
    const dH: number[] = [];
    const dS: number[] = [];
    const dL: number[] = [];
    for (let i = 0; i <= N; i++) {
      const h = 6 + (18 * i) / N;
      dH.push(h);
      dS.push(getSolarKw(h));
      dL.push(getLoadKw(h));
    }

    // ── Grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let kw = 0; kw <= maxKw; kw += 2) {
      const y = yForKw(kw);
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(chartW - PAD.right, y);
      ctx.stroke();
    }

    // Y-axis labels
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.font = "500 9px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let kw = 0; kw <= maxKw; kw += 2) {
      ctx.fillText(String(kw), PAD.left - 6, yForKw(kw));
    }

    // X-axis labels
    const xLabels: [number, string][] = [
      [6, "6am"], [9, "9am"], [12, "12pm"], [15, "3pm"],
      [18, "6pm"], [21, "9pm"], [24, "12am"],
    ];
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    xLabels.forEach(([h, lbl]) => {
      ctx.fillText(lbl, xForHour(h), chartH - PAD.bottom + 7);
    });

    // ── Surplus fill (solar > load)
    ctx.save();
    ctx.beginPath();
    let inSurplus = false;
    for (let i = 0; i <= N; i++) {
      const x = xForHour(dH[i]);
      if (dS[i] > dL[i]) {
        if (!inSurplus) { ctx.moveTo(x, yForKw(dL[i])); inSurplus = true; }
        ctx.lineTo(x, yForKw(dL[i]));
      } else if (inSurplus) { inSurplus = false; }
    }
    for (let i = N; i >= 0; i--) {
      if (dS[i] > dL[i]) ctx.lineTo(xForHour(dH[i]), yForKw(dS[i]));
    }
    ctx.closePath();
    const surplusGrad = ctx.createLinearGradient(0, PAD.top, 0, baseline);
    surplusGrad.addColorStop(0, "rgba(234,179,8,0.14)");
    surplusGrad.addColorStop(1, "rgba(234,179,8,0.03)");
    ctx.fillStyle = surplusGrad;
    ctx.fill();
    ctx.restore();

    // ── Deficit fill (load > solar, evening)
    ctx.save();
    ctx.beginPath();
    let inDeficit = false;
    for (let i = 0; i <= N; i++) {
      const x = xForHour(dH[i]);
      if (dL[i] > dS[i] && dH[i] >= 16) {
        if (!inDeficit) { ctx.moveTo(x, yForKw(dS[i])); inDeficit = true; }
        ctx.lineTo(x, yForKw(dS[i]));
      } else if (inDeficit) { inDeficit = false; }
    }
    for (let i = N; i >= 0; i--) {
      if (dL[i] > dS[i] && dH[i] >= 16) ctx.lineTo(xForHour(dH[i]), yForKw(dL[i]));
    }
    ctx.closePath();
    const deficitGrad = ctx.createLinearGradient(0, PAD.top, 0, baseline);
    deficitGrad.addColorStop(0, "rgba(239,68,68,0.06)");
    deficitGrad.addColorStop(1, "rgba(239,68,68,0.12)");
    ctx.fillStyle = deficitGrad;
    ctx.fill();
    ctx.restore();

    // ── Solar area fill
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(xForHour(6), baseline);
    for (let i = 0; i <= N; i++) ctx.lineTo(xForHour(dH[i]), yForKw(dS[i]));
    ctx.lineTo(xForHour(24), baseline);
    ctx.closePath();
    const solarGrad = ctx.createLinearGradient(0, yForKw(8), 0, baseline);
    solarGrad.addColorStop(0, "rgba(234,179,8,0.25)");
    solarGrad.addColorStop(0.5, "rgba(234,179,8,0.10)");
    solarGrad.addColorStop(1, "rgba(234,179,8,0.02)");
    ctx.fillStyle = solarGrad;
    ctx.fill();
    ctx.restore();

    // ── Solar curve line
    const solarPts: [number, number][] = [];
    for (let h = 6; h <= 24; h++) solarPts.push([xForHour(h), yForKw(getSolarKw(h))]);

    ctx.save();
    ctx.beginPath();
    drawCardinalSpline(ctx, solarPts, 0.3);
    ctx.strokeStyle = "rgba(234,179,8,0.7)";
    ctx.lineWidth = 2;
    ctx.stroke();
    // Glow
    ctx.beginPath();
    drawCardinalSpline(ctx, solarPts, 0.3);
    ctx.strokeStyle = "rgba(234,179,8,0.15)";
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.restore();

    // ── Load curve line (dashed)
    const loadPts: [number, number][] = [];
    for (let h = 6; h <= 24; h++) loadPts.push([xForHour(h), yForKw(getLoadKw(h))]);

    ctx.save();
    ctx.beginPath();
    drawCardinalSpline(ctx, loadPts, 0.3);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.restore();

    // ── Peak hours shading (4pm–9pm)
    ctx.save();
    const peakX1 = xForHour(16);
    const peakX2 = xForHour(21);
    const peakGrad = ctx.createLinearGradient(0, PAD.top, 0, baseline);
    peakGrad.addColorStop(0, "rgba(249,115,22,0.03)");
    peakGrad.addColorStop(1, "rgba(249,115,22,0.06)");
    ctx.fillStyle = peakGrad;
    ctx.fillRect(peakX1, PAD.top, peakX2 - peakX1, plotH);
    ctx.strokeStyle = "rgba(249,115,22,0.12)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(peakX1, PAD.top);
    ctx.lineTo(peakX1, PAD.top + plotH);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(peakX2, PAD.top);
    ctx.lineTo(peakX2, PAD.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(249,115,22,0.30)";
    ctx.font = "600 8px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("PEAK", (peakX1 + peakX2) / 2, PAD.top + 10);
    ctx.restore();

    // ── NOW indicator
    const nowHour = new Date().getHours() + new Date().getMinutes() / 60;
    if (nowHour >= 6 && nowHour <= 24) {
      const nowX = xForHour(nowHour);
      ctx.save();
      ctx.strokeStyle = "rgba(234,179,8,0.5)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(nowX, PAD.top);
      ctx.lineTo(nowX, chartH - PAD.bottom);
      ctx.stroke();
      ctx.setLineDash([]);

      // Dot on solar curve
      const nowSolar = getSolarKw(nowHour);
      ctx.fillStyle = "#eab308";
      ctx.beginPath();
      ctx.arc(nowX, yForKw(nowSolar), 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(234,179,8,0.2)";
      ctx.beginPath();
      ctx.arc(nowX, yForKw(nowSolar), 8, 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.fillStyle = "rgba(234,179,8,0.7)";
      ctx.font = "600 8px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("NOW", nowX, PAD.top - 1);
      ctx.restore();
    }
  }, [getSolarKw, getLoadKw]);

  /* ─── Draw on mount & plan change ─── */
  useEffect(() => {
    draw();
    const handleResize = () => draw();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [draw]);

  /* ─── Build swim lanes ─── */
  const lanes = plan?.hours ? buildSwimLanes(plan.hours) : defaultSwimLanes;
  const nowHour = new Date().getHours() + new Date().getMinutes() / 60;
  const nowPct = Math.max(0, Math.min(100, ((nowHour - 6) / 18) * 100));

  function swimPct(h: number) {
    return ((h - 6) / 18) * 100;
  }

  /* ─── Summary text ─── */
  const totalSolar = plan?.total_solar_kwh ?? 38;
  const solarQuality =
    totalSolar > 30 ? "Good solar day" : totalSolar > 15 ? "Moderate solar" : "Low solar day";
  const solarEmoji = totalSolar > 30 ? "☀️" : totalSolar > 15 ? "⛅" : "☁️";

  // Build brief plan description
  let planActions = "";
  if (plan?.hours) {
    const parts: string[] = [];
    const pwCharge = plan.hours.find(h => h.pw_action === "charge");
    const pwDischarge = plan.hours.find(h => h.pw_action === "discharge");
    if (pwCharge) parts.push("bank Powerwall");
    const evCharge = plan.hours.find(h => h.ev_action === "charge" || h.ev_action === "recommend_charge");
    if (evCharge) parts.push(`charge EV at ${fmtHour(evCharge.hour)}`);
    const precool = plan.hours.find(h => h.hvac_action === "precool");
    if (precool) parts.push("pre-cool before peak");
    if (pwDischarge) parts.push(`discharge ${fmtHour(pwDischarge.hour)}–9pm`);
    planActions = parts.length > 0 ? parts.join(", ") + "." : "";
  } else {
    planActions = "Bank Powerwall, charge EV midday, pre-cool before peak.";
  }

  return (
    <div className="bg-[#111827]/85 rounded-2xl p-3 pb-3 border border-white/[0.04] relative overflow-hidden backdrop-blur-xl">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />

      {/* Summary */}
      <p className="text-[13px] text-gray-400 leading-relaxed mb-3 px-0.5">
        {solarEmoji}{" "}
        <span className="text-gray-200 font-semibold">{solarQuality}</span>
        {" "}— {Math.round(totalSolar)} kWh predicted. {planActions}
        <span className="inline-block ml-1 text-[9px] font-semibold text-orange-400 bg-orange-500/[0.08] border border-orange-500/[0.15] px-1.5 py-0.5 rounded-full align-middle">
          Peak 4–9 PM
        </span>
      </p>

      {/* Canvas chart */}
      <div ref={wrapRef} className="relative mx-[-4px]">
        <canvas ref={canvasRef} />
      </div>

      {/* Swim lanes */}
      <div className="relative mt-0.5">
        {(
          [
            ["PW", lanes.pw],
            ["EV", lanes.ev],
            ["HVAC", lanes.hvac],
          ] as [string, SwimSegment[]][]
        ).map(([label, segs]) => (
          <div key={label} className="flex items-center h-5">
            <span className="w-[34px] text-[9px] font-semibold text-gray-600 text-right pr-2 shrink-0 tracking-wide">
              {label}
            </span>
            <div className="flex-1 h-[10px] bg-white/[0.015] rounded-[3px] relative overflow-hidden">
              {segs.map((seg, i) => (
                <div
                  key={i}
                  className="absolute top-0 h-full rounded-[3px]"
                  style={{
                    left: `${swimPct(seg.startH)}%`,
                    width: `${swimPct(seg.endH) - swimPct(seg.startH)}%`,
                    background: seg.color,
                  }}
                />
              ))}
            </div>
          </div>
        ))}
        {/* NOW line through swim lanes */}
        {nowHour >= 6 && nowHour <= 24 && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left: `calc(34px + (100% - 34px) * ${nowPct / 100})`,
              borderLeft: "1.5px dashed rgba(234,179,8,0.35)",
            }}
          />
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-2.5 gap-y-1 mt-3 pt-2.5 border-t border-white/[0.03]">
        {[
          { label: "Solar", color: "rgba(234,179,8,0.5)", type: "dot" },
          { label: "Load", color: "rgba(255,255,255,0.35)", type: "line" },
          { label: "Surplus", color: "rgba(234,179,8,0.18)", type: "dot" },
          { label: "PW Charge", color: "rgba(34,197,94,0.6)", type: "dot" },
          { label: "PW Discharge", color: "rgba(249,115,22,0.6)", type: "dot" },
          { label: "EV Charge", color: "rgba(168,85,247,0.6)", type: "dot" },
          { label: "Pre-cool", color: "rgba(59,130,246,0.6)", type: "dot" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-1 text-[9px] text-gray-600 font-medium">
            {item.type === "dot" ? (
              <div className="w-[7px] h-[7px] rounded-sm shrink-0" style={{ background: item.color }} />
            ) : (
              <div className="w-[10px] h-[2px] rounded-sm shrink-0" style={{ background: item.color }} />
            )}
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}
