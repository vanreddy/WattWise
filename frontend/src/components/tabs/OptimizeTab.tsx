"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import {
  Zap,
  BatteryWarning,
  Sun,
  Car,
  Thermometer,
  TrendingDown,
  Lightbulb,
  Clock,
  ChevronUp,
  ChevronDown,
  Plug,
  PlugZap,
  RefreshCw,
  Battery,
  Activity,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  SummaryResponse, DailySummary, Alert, NestDevice,
  SmartcarVehicle, SmartcarVehicleStatus,
  OptimizerPlan, OptimizerLogEntry, OptimizerState, TimelineSegment,
} from "@/lib/api";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";

/* ─── Types ─────────────────────────────────── */

interface Suggestion {
  id: string;
  icon: ReactNode;
  iconBg: string;
  title: string;
  description: string;
  savings: string | null;
  priority: "high" | "medium" | "low";
}

interface Props {
  summary: SummaryResponse | null;
  daily: DailySummary[];
  alerts: Alert[];
}

/* ─── Helpers ─── */

function cToF(c: number | null): number | null {
  if (c === null || c === undefined) return null;
  return Math.round(c * 9 / 5 + 32);
}

function fToDisplay(f: number | null): string {
  if (f === null) return "—";
  return `${f}°F`;
}

function fmtHour(h: number): string {
  if (h === 0 || h === 24) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

/* ═══════════════════════════════════════════════ */
/* ═══ SHARED DEVICE CARDS ═══════════════════════ */
/* ═══════════════════════════════════════════════ */

function PowerwallCard({
  summary,
  scheduleLine,
  reservePct,
  onReserveChange,
}: {
  summary: SummaryResponse | null;
  scheduleLine?: string;
  reservePct?: number;
  onReserveChange?: (v: number) => void;
}) {
  if (!summary) return null;
  const { battery_pct, battery_w } = summary.current;
  const isCharging = battery_w > 100;
  const isDischarging = battery_w < -100;
  const powerKw = Math.abs(battery_w / 1000).toFixed(1);

  const statusText = isCharging
    ? `Charging at ${powerKw} kW`
    : isDischarging
    ? `Discharging at ${powerKw} kW`
    : "Idle";

  const statusColor = isCharging ? "text-green-400" : isDischarging ? "text-yellow-400" : "text-gray-500";
  const pct = Math.max(0, Math.min(100, battery_pct));
  const kwhEstimate = (pct / 100 * 13.5).toFixed(1);

  return (
    <div className="bg-[#111827] rounded-xl p-3.5 border border-white/[0.04] relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />
      <div className="flex items-center gap-2.5 mb-2.5">
        <div className="w-[34px] h-[34px] rounded-[9px] bg-green-500/10 flex items-center justify-center">
          <Battery size={16} className="text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold">Powerwall</div>
          <div className={`text-[10px] ${statusColor}`}>{statusText}</div>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-emerald-400">{Math.round(pct)}%</div>
          <div className="text-[10px] text-gray-500">{kwhEstimate} kWh</div>
        </div>
      </div>
      <div className="w-full h-[5px] bg-[#1a1f2e] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-1000"
          style={{ width: `${pct}%` }}
        />
      </div>
      {scheduleLine && (
        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-white/[0.04] text-[10px] text-gray-500">
          <span className="w-4 h-4 rounded bg-yellow-500/10 flex items-center justify-center text-yellow-400 text-[9px]">⏱</span>
          <span dangerouslySetInnerHTML={{ __html: scheduleLine }} />
        </div>
      )}
      {reservePct != null && onReserveChange && (
        <InlineSlider
          label="Reserve"
          value={reservePct}
          min={0}
          max={100}
          step={5}
          formatValue={v => `${v}%`}
          onChange={onReserveChange}
        />
      )}
    </div>
  );
}

/* ─── Nest Thermostat Mini Card ─── */

function NestThermostatMini({ device, onRefresh, readOnly }: { device: NestDevice; onRefresh: () => void; readOnly?: boolean }) {
  const [commanding, setCommanding] = useState(false);
  const ambientF = cToF(device.ambient_temp_c);
  const coolSetpointF = cToF(device.cool_setpoint_c);
  const heatSetpointF = cToF(device.heat_setpoint_c);
  const isEco = device.eco_mode === "MANUAL_ECO";
  const hvacStatus = device.hvac_status || "OFF";
  const mode = device.mode || "OFF";
  const setpointF = mode === "HEAT" ? heatSetpointF : (mode === "COOL" || mode === "HEATCOOL") ? coolSetpointF : null;
  const effectiveMode = isEco ? "ECO" : mode;

  const hvacColor = hvacStatus === "COOLING" ? "text-blue-400" : hvacStatus === "HEATING" ? "text-orange-400" : "text-gray-500";
  const hvacIcon = hvacStatus === "COOLING" ? "❄️" : hvacStatus === "HEATING" ? "🔥" : isEco ? "🍃" : "";
  const hvacLabel = hvacStatus === "COOLING" ? "Cooling" : hvacStatus === "HEATING" ? "Heating" : isEco ? "Eco" : "Idle";

  const shortName = device.display_name?.replace(/nest\s*(thermostat)?\s*[-–—]?\s*/i, "").trim() || device.display_name || "Thermostat";

  async function adjustTemp(delta: number) {
    if (commanding) return;
    setCommanding(true);
    try {
      await api.nestSetCool(device.device_id, (coolSetpointF ?? 72) + delta);
      onRefresh();
    } catch { /* */ } finally { setCommanding(false); }
  }

  async function switchMode(newMode: string) {
    if (commanding || newMode === effectiveMode) return;
    setCommanding(true);
    try {
      await api.nestSetMode(device.device_id, newMode);
      onRefresh();
    } catch { /* */ } finally { setCommanding(false); }
  }

  return (
    <div>
      <div className="bg-white/[0.02] border border-white/[0.04] rounded-[10px] p-3 h-full flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-gray-300">{shortName}</span>
          <span className={`text-[9px] font-medium ${hvacColor}`}>{hvacIcon} {hvacLabel}</span>
        </div>
        <div className="mb-3">
          <span className="text-[26px] font-bold leading-none">{fToDisplay(ambientF)}</span>
          {device.humidity_pct != null && <span className="text-[10px] text-gray-500 ml-1.5">{device.humidity_pct}%</span>}
        </div>
        {readOnly ? (
          /* Auto mode: show current mode as a static badge */
          <div className="flex items-center gap-1.5 mt-auto">
            <span className={`text-[9px] font-semibold px-2 py-1 rounded-md ${
              effectiveMode === "COOL" ? "text-blue-400 bg-blue-500/[0.12]" :
              effectiveMode === "HEAT" ? "text-orange-400 bg-orange-500/[0.12]" :
              effectiveMode === "ECO" ? "text-green-400 bg-green-500/[0.12]" :
              "text-gray-500 bg-white/[0.05]"
            }`}>{effectiveMode}</span>
            {setpointF != null && <span className="text-[10px] text-gray-500">→ {setpointF}°F</span>}
          </div>
        ) : (
          /* Manual mode: full controls */
          <>
            <div className="flex gap-0.5 bg-white/[0.03] rounded-lg p-0.5 mb-2">
              {([
                { key: "OFF", label: "Off", color: "text-gray-400 bg-white/[0.08]" },
                { key: "COOL", label: "Cool", color: "text-blue-400 bg-blue-500/[0.15]" },
                { key: "HEAT", label: "Heat", color: "text-orange-400 bg-orange-500/[0.15]" },
                { key: "ECO", label: "Eco", color: "text-green-400 bg-green-500/[0.15]" },
              ] as const).map(({ key, label, color }) => (
                <button key={key} onClick={() => switchMode(key)} disabled={commanding}
                  className={`flex-1 py-1.5 rounded-md text-[9px] font-semibold transition-all disabled:opacity-50 ${effectiveMode === key ? color : "text-gray-600 hover:text-gray-400"}`}>
                  {label}
                </button>
              ))}
            </div>
            {(effectiveMode === "COOL" || effectiveMode === "HEAT" || effectiveMode === "HEATCOOL") && (
              <div className="flex items-center justify-between bg-white/[0.03] rounded-lg px-2 py-1.5">
                <button onClick={() => adjustTemp(-1)} disabled={commanding}
                  className="w-8 h-8 flex items-center justify-center rounded-md bg-white/[0.06] text-gray-300 text-sm font-bold hover:bg-white/[0.12] disabled:opacity-30 transition-colors">
                  <ChevronDown size={16} />
                </button>
                <div className="text-center">
                  <div className="text-[10px] text-gray-500 leading-none">Set to</div>
                  <div className="text-sm font-bold text-blue-400 leading-tight">{setpointF != null ? `${setpointF}°F` : "—"}</div>
                </div>
                <button onClick={() => adjustTemp(1)} disabled={commanding}
                  className="w-8 h-8 flex items-center justify-center rounded-md bg-white/[0.06] text-gray-300 text-sm font-bold hover:bg-white/[0.12] disabled:opacity-30 transition-colors">
                  <ChevronUp size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Nest Card ─── */

function NestCard({
  scheduleLine,
  readOnly,
  comfortMin,
  comfortMax,
  onComfortMinChange,
  onComfortMaxChange,
}: {
  scheduleLine?: string;
  readOnly?: boolean;
  comfortMin?: number;
  comfortMax?: number;
  onComfortMinChange?: (v: number) => void;
  onComfortMaxChange?: (v: number) => void;
}) {
  const { user } = useAuth();
  const [devices, setDevices] = useState<NestDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.getNestDevices();
      if (res.devices.length > 0) { setDevices(res.devices); setError(null); }
      else setError("No thermostats found");
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to fetch"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (user?.nest_connected) fetchStatus(); else setLoading(false); }, [user?.nest_connected, fetchStatus]);

  if (!user?.nest_connected) return null;
  if (loading) return (
    <div className="bg-[#111827] rounded-xl p-3.5 border border-white/[0.04]">
      <div className="flex items-center gap-2"><div className="w-[34px] h-[34px] rounded-[9px] bg-blue-500/10 flex items-center justify-center"><Thermometer size={16} className="text-blue-400" /></div><span className="text-[13px] font-semibold">Nest Thermostats</span></div>
      <p className="text-[10px] text-gray-500 mt-2">Loading...</p>
    </div>
  );
  if (error || devices.length === 0) return (
    <div className="bg-[#111827] rounded-xl p-3.5 border border-white/[0.04]">
      <div className="flex items-center gap-2"><div className="w-[34px] h-[34px] rounded-[9px] bg-blue-500/10 flex items-center justify-center"><Thermometer size={16} className="text-blue-400" /></div><span className="text-[13px] font-semibold">Nest Thermostats</span></div>
      <p className="text-[10px] text-red-400 mt-2">{error || "No devices"}</p>
    </div>
  );

  return (
    <div className="bg-[#111827] rounded-xl p-3.5 border border-white/[0.04] relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />
      <div className="flex items-center gap-2.5 mb-2.5">
        <div className="w-[34px] h-[34px] rounded-[9px] bg-blue-500/10 flex items-center justify-center"><Thermometer size={16} className="text-blue-400" /></div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold">Nest Thermostats</div>
          <div className="text-[10px] text-gray-500">{devices.length} device{devices.length !== 1 ? "s" : ""}</div>
        </div>
        <button onClick={fetchStatus} className="text-gray-600 hover:text-gray-400 transition-colors"><RefreshCw size={14} /></button>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {devices.map(d => <NestThermostatMini key={d.device_id} device={d} onRefresh={fetchStatus} readOnly={readOnly} />)}
      </div>
      {scheduleLine && (
        <div className="flex items-center gap-1.5 mt-2.5 pt-2 border-t border-white/[0.04] text-[10px] text-gray-500">
          <span className="w-4 h-4 rounded bg-blue-500/10 flex items-center justify-center text-blue-400 text-[9px]">⏱</span>
          <span dangerouslySetInnerHTML={{ __html: scheduleLine }} />
        </div>
      )}
      {comfortMin != null && comfortMax != null && onComfortMinChange && onComfortMaxChange && (
        <InlineRangeSlider
          label="Comfort"
          low={comfortMin}
          high={comfortMax}
          min={60}
          max={85}
          formatValue={(lo, hi) => `${lo}–${hi}°`}
          onChangeLow={onComfortMinChange}
          onChangeHigh={onComfortMaxChange}
        />
      )}
    </div>
  );
}

/* ─── BMW Card ─── */

function BMWCard({
  scheduleLine,
  evMinPct,
  evMaxPct,
  onEvMinChange,
  onEvMaxChange,
}: {
  scheduleLine?: string;
  evMinPct?: number;
  evMaxPct?: number;
  onEvMinChange?: (v: number) => void;
  onEvMaxChange?: (v: number) => void;
}) {
  const { user } = useAuth();
  const [vehicle, setVehicle] = useState<SmartcarVehicle | null>(null);
  const [status, setStatus] = useState<SmartcarVehicleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commanding, setCommanding] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const vehicles = await api.getSmartcarVehicles();
      if (vehicles.vehicles.length > 0) {
        const v = vehicles.vehicles[0]; setVehicle(v);
        setStatus(await api.getSmartcarVehicleStatus(v.vehicle_id)); setError(null);
      } else setError("No vehicles found");
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to fetch"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (user?.smartcar_connected) fetchStatus(); else setLoading(false); }, [user?.smartcar_connected, fetchStatus]);

  if (!user?.smartcar_connected) return null;
  if (loading) return (
    <div className="bg-[#111827] rounded-xl p-3.5 border border-white/[0.04]">
      <div className="flex items-center gap-2"><div className="w-[34px] h-[34px] rounded-[9px] bg-purple-500/10 flex items-center justify-center"><Car size={16} className="text-purple-400" /></div><span className="text-[13px] font-semibold">BMW iX</span></div>
      <p className="text-[10px] text-gray-500 mt-2">Loading...</p>
    </div>
  );
  if (error || !status) return (
    <div className="bg-[#111827] rounded-xl p-3.5 border border-white/[0.04]">
      <div className="flex items-center gap-2"><div className="w-[34px] h-[34px] rounded-[9px] bg-purple-500/10 flex items-center justify-center"><Car size={16} className="text-purple-400" /></div><span className="text-[13px] font-semibold">BMW iX</span></div>
      <p className="text-[10px] text-red-400 mt-2">{error || "No status"}</p>
    </div>
  );

  const pct = status.percent_remaining != null ? Math.round(status.percent_remaining * 100) : null;
  const isPlugged = status.is_plugged_in;
  const isCharging = status.charge_state === "CHARGING";
  const rangeMi = status.range_miles;
  const label = vehicle ? `${vehicle.year || ""} ${vehicle.make || "BMW"} ${vehicle.model || "iX"}`.trim() : "BMW iX";
  const plugStatus = isCharging ? "Charging" : isPlugged ? "⚡ Plugged in" : "Unplugged";
  const plugColor = isCharging ? "text-green-400" : isPlugged ? "text-yellow-400" : "text-gray-500";

  async function handleChargeToggle() {
    if (!vehicle || commanding) return;
    setCommanding(true);
    try {
      if (isCharging) await api.smartcarStopCharge(vehicle.vehicle_id);
      else await api.smartcarStartCharge(vehicle.vehicle_id);
      await new Promise(r => setTimeout(r, 2000));
      await fetchStatus();
    } catch { /* */ } finally { setCommanding(false); }
  }

  return (
    <div className="bg-[#111827] rounded-xl p-3.5 border border-white/[0.04] relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />
      <div className="flex items-center gap-2.5 mb-2.5">
        <div className="w-[34px] h-[34px] rounded-[9px] bg-purple-500/10 flex items-center justify-center"><Car size={16} className="text-purple-400" /></div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold">{label}</div>
          <div className={`text-[10px] ${plugColor}`}>{plugStatus}</div>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-purple-400">{pct != null ? `${pct}%` : "—"}</div>
          {rangeMi != null && <div className="text-[10px] text-gray-500">{Math.round(rangeMi)} mi</div>}
        </div>
      </div>
      {pct != null && (
        <div className="w-full h-[5px] bg-[#1a1f2e] rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-purple-600 to-purple-400 transition-all duration-1000" style={{ width: `${pct}%` }} />
        </div>
      )}
      {isPlugged && !scheduleLine && (
        <div className="mt-2 pt-2 border-t border-white/[0.04]">
          <button onClick={handleChargeToggle} disabled={commanding}
            className={`w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold py-2 rounded-lg transition-all border ${isCharging ? "bg-red-500/[0.08] text-red-400 border-red-500/20" : "bg-green-500/[0.08] text-green-400 border-green-500/20"} disabled:opacity-50`}>
            {commanding ? <RefreshCw size={12} className="animate-spin" /> : isCharging ? <><Plug size={12} /> Stop Charging</> : <><PlugZap size={12} /> Start Charging</>}
          </button>
        </div>
      )}
      {scheduleLine && (
        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-white/[0.04] text-[10px] text-gray-500">
          <span className="w-4 h-4 rounded bg-purple-500/10 flex items-center justify-center text-purple-400 text-[9px]">⏱</span>
          <span dangerouslySetInnerHTML={{ __html: scheduleLine }} />
        </div>
      )}
      {evMinPct != null && evMaxPct != null && onEvMinChange && onEvMaxChange && (
        <InlineRangeSlider
          label="EV Target"
          low={evMinPct}
          high={evMaxPct}
          min={20}
          max={100}
          step={5}
          formatValue={(lo, hi) => `${lo}–${hi}%`}
          onChangeLow={onEvMinChange}
          onChangeHigh={onEvMaxChange}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════ */
/* ═══ AUTO MODE COMPONENTS ══════════════════════ */
/* ═══════════════════════════════════════════════ */

const SEGMENT_COLORS: Record<string, string> = {
  yellow: "rgba(234,179,8,0.4)",
  green: "rgba(34,197,94,0.35)",
  purple: "rgba(168,85,247,0.4)",
  blue: "rgba(59,130,246,0.4)",
  gray: "rgba(255,255,255,0.04)",
  neutral: "rgba(255,255,255,0.03)",
};

function TimelineBar({ segments, currentHour }: { segments: TimelineSegment[]; currentHour: number }) {
  // Map hours 6am–midnight (18 hours) to a bar
  const barStart = 6;
  const barEnd = 24;
  const barSpan = barEnd - barStart;
  const nowPct = Math.max(0, Math.min(100, ((currentHour - barStart) / barSpan) * 100));

  return (
    <div className="relative mt-1">
      {/* Hour labels */}
      <div className="flex justify-between text-[9px] text-gray-600 mb-1.5 px-0.5">
        {[6, 9, 12, 15, 18, 21, 24].map(h => <span key={h}>{fmtHour(h % 24)}</span>)}
      </div>
      {/* Bar */}
      <div className="h-6 bg-[#1a1f2e] rounded-md relative flex overflow-visible">
        {segments.map((seg, i) => {
          const start = Math.max(seg.start_hour, barStart);
          const end = Math.min(seg.end_hour || seg.start_hour + 1, barEnd);
          const widthPct = ((end - start) / barSpan) * 100;
          if (widthPct <= 0) return null;
          return (
            <div key={i} className="h-full" style={{
              width: `${widthPct}%`,
              background: SEGMENT_COLORS[seg.color] || SEGMENT_COLORS.neutral,
              borderRadius: i === 0 ? "6px 0 0 6px" : i === segments.length - 1 ? "0 6px 6px 0" : undefined,
            }} />
          );
        })}
        {/* NOW dot */}
        {nowPct > 0 && nowPct < 100 && (
          <div className="absolute top-[-4px] flex flex-col items-center z-10" style={{ left: `${nowPct}%` }}>
            <div className="w-2.5 h-2.5 bg-yellow-400 rounded-full border-2 border-[#111827] animate-pulse" />
            <div className="w-0.5 h-5 bg-yellow-400/50" />
          </div>
        )}
      </div>
      {/* Legend */}
      <div className="flex gap-2.5 mt-2 flex-wrap">
        {segments.filter(s => s.color !== "neutral" && s.label).map((seg, i) => (
          <div key={i} className="flex items-center gap-1 text-[9px] text-gray-500">
            <div className="w-2 h-2 rounded-sm" style={{ background: SEGMENT_COLORS[seg.color] }} />
            {seg.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityLog({ entries }: { entries: OptimizerLogEntry[] }) {
  const DEVICE_COLORS: Record<string, string> = {
    powerwall: "bg-green-400", ev: "bg-purple-400", nest: "bg-blue-400",
  };

  if (entries.length === 0) return (
    <div className="text-[11px] text-gray-600 text-center py-3">No activity yet today</div>
  );

  return (
    <div>
      {entries.slice(0, 6).map((e, i) => {
        const d = new Date(e.ts);
        const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).replace(" ", "");
        return (
          <div key={i} className="flex gap-2 py-2 border-b border-white/[0.02] last:border-0">
            <span className="text-[10px] text-gray-600 font-medium w-[52px] shrink-0">{timeStr}</span>
            <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${DEVICE_COLORS[e.device] || "bg-gray-500"}`} />
            <span className="text-[11px] text-gray-400 leading-relaxed">{e.reason}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════ */
/* ═══ INLINE SLIDER CONTROLS ═══════════════════ */
/* ═══════════════════════════════════════════════ */

function InlineSlider({
  label,
  value,
  min,
  max,
  step = 1,
  formatValue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  formatValue: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex items-center justify-between gap-3 pt-2.5 mt-2.5 border-t border-white/[0.04]">
      <span className="text-[11px] text-gray-500 shrink-0">{label}</span>
      <div className="flex items-center gap-2 flex-1 justify-end">
        <div className="relative w-[120px] h-[4px] bg-[#1a1f2e] rounded-full">
          <div className="h-full rounded-full bg-yellow-400/60" style={{ width: `${pct}%` }} />
          <input
            type="range" min={min} max={max} step={step} value={value}
            onChange={e => onChange(Number(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-[14px] h-[14px] bg-white rounded-full shadow-[0_1px_4px_rgba(0,0,0,0.4)] pointer-events-none"
            style={{ left: `calc(${pct}% - 7px)` }}
          />
        </div>
        <span className="text-[12px] font-semibold text-gray-200 tabular-nums min-w-[36px] text-right">{formatValue(value)}</span>
      </div>
    </div>
  );
}

function InlineRangeSlider({
  label,
  low,
  high,
  min,
  max,
  step = 1,
  formatValue,
  onChangeLow,
  onChangeHigh,
}: {
  label: string;
  low: number;
  high: number;
  min: number;
  max: number;
  step?: number;
  formatValue: (lo: number, hi: number) => string;
  onChangeLow: (v: number) => void;
  onChangeHigh: (v: number) => void;
}) {
  const range = max - min;
  const loPct = ((low - min) / range) * 100;
  const hiPct = ((high - min) / range) * 100;
  return (
    <div className="flex items-center justify-between gap-3 pt-2.5 mt-2.5 border-t border-white/[0.04]">
      <span className="text-[11px] text-gray-500 shrink-0">{label}</span>
      <div className="flex items-center gap-2 flex-1 justify-end">
        <div className="relative w-[120px] h-[4px] bg-[#1a1f2e] rounded-full">
          {/* Filled range between low and high */}
          <div
            className="absolute h-full rounded-full bg-yellow-400/60"
            style={{ left: `${loPct}%`, width: `${hiPct - loPct}%` }}
          />
          {/* Low thumb - invisible input overlay */}
          <input
            type="range" min={min} max={max} step={step} value={low}
            onChange={e => {
              const v = Number(e.target.value);
              if (v < high) onChangeLow(v);
            }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
          {/* High thumb - invisible input overlay */}
          <input
            type="range" min={min} max={max} step={step} value={high}
            onChange={e => {
              const v = Number(e.target.value);
              if (v > low) onChangeHigh(v);
            }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
          />
          {/* Visual thumb dots */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-[12px] h-[12px] bg-white rounded-full shadow-[0_1px_4px_rgba(0,0,0,0.4)] pointer-events-none z-30"
            style={{ left: `calc(${loPct}% - 6px)` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-[12px] h-[12px] bg-white rounded-full shadow-[0_1px_4px_rgba(0,0,0,0.4)] pointer-events-none z-30"
            style={{ left: `calc(${hiPct}% - 6px)` }}
          />
        </div>
        <span className="text-[12px] font-semibold text-gray-200 tabular-nums min-w-[60px] text-right">{formatValue(low, high)}</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════ */
/* ═══ REAL-TIME SUGGESTIONS ═════════════════════ */
/* ═══════════════════════════════════════════════ */

function realtimeSuggestions(summary: SummaryResponse | null, daily: DailySummary[]): Suggestion[] {
  const out: Suggestion[] = [];
  const today = daily[0] ?? null;

  if (summary && summary.current.grid_w < -2000) {
    const kw = Math.abs(summary.current.grid_w / 1000);
    out.push({ id: "solar-surplus", icon: <Sun size={20} />, iconBg: "bg-yellow-500/20 text-yellow-400",
      title: "Use your solar surplus",
      description: `You're exporting ${kw.toFixed(1)} kW to the grid at ~$0.07/kWh. That same energy powers your home at $0.32/kWh — 5x more valuable.`,
      savings: `$${(kw * 0.25).toFixed(2)}/hr potential`, priority: "high" });
  }

  if (today && today.ev_peak_kwh > 0.5) {
    out.push({ id: "ev-off-peak", icon: <Clock size={20} />, iconBg: "bg-purple-500/20 text-purple-400",
      title: "EV charged during peak yesterday",
      description: `You charged ${today.ev_peak_kwh.toFixed(1)} kWh during peak at $0.356/kWh. Scheduling for solar hours uses free solar instead.`,
      savings: `$${(today.ev_peak_kwh * 0.037).toFixed(2)}/day savings`, priority: "high" });
  }

  if (today && today.battery_depletion_hour !== null && today.battery_depletion_hour < 21) {
    const h = today.battery_depletion_hour;
    const fmt = h >= 12 ? `${h === 12 ? 12 : h - 12} PM` : `${h} AM`;
    out.push({ id: "battery-depletion", icon: <BatteryWarning size={20} />, iconBg: "bg-emerald-500/20 text-emerald-400",
      title: "Powerwall ran out early yesterday",
      description: `Depleted at ${fmt} — before the 9 PM peak end. Consider lowering reserve to extend dispatch.`,
      savings: null, priority: "medium" });
  }

  if (today && today.solar_generated_kwh > 10) {
    const ratio = today.solar_self_consumed_kwh / today.solar_generated_kwh;
    if (ratio < 0.5) {
      out.push({ id: "self-consumption", icon: <TrendingDown size={20} />, iconBg: "bg-orange-500/20 text-orange-400",
        title: "Low solar self-consumption yesterday",
        description: `Only ${(ratio * 100).toFixed(0)}% of solar was used at home. Shifting loads to midday could capture the rest.`,
        savings: `$${((today.solar_generated_kwh - today.solar_self_consumed_kwh) * 0.25).toFixed(2)}/day`, priority: "medium" });
    }
  }

  return out;
}

/* ═══════════════════════════════════════════════ */
/* ═══ SHARED UI ═════════════════════════════════ */
/* ═══════════════════════════════════════════════ */

function PriorityBadge({ priority }: { priority: Suggestion["priority"] }) {
  const styles = { high: "bg-red-500/15 text-red-400 border-red-500/30", medium: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30", low: "bg-gray-500/15 text-gray-400 border-gray-500/30" };
  return <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${styles[priority]}`}>{priority}</span>;
}

function SuggestionCard({ s }: { s: Suggestion }) {
  return (
    <div className="bg-[#111827] rounded-xl p-3.5 border border-white/[0.04] relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />
      <div className="flex items-start gap-2.5">
        <div className={`w-9 h-9 rounded-[10px] shrink-0 flex items-center justify-center ${s.iconBg}`}>{s.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="text-xs font-semibold text-gray-200">{s.title}</h3>
            <PriorityBadge priority={s.priority} />
          </div>
          <p className="text-[11px] text-gray-500 leading-relaxed">{s.description}</p>
          {s.savings && <p className="text-[11px] font-semibold text-emerald-400 mt-1.5">{s.savings}</p>}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 mb-2.5 flex items-center gap-1.5">
      {icon}{children}
    </h2>
  );
}

/* ═══════════════════════════════════════════════ */
/* ═══ MAIN TAB ══════════════════════════════════ */
/* ═══════════════════════════════════════════════ */

export default function OptimizeTab({ summary, daily, alerts: _alerts }: Props) {
  const { user } = useAuth();
  const realtime = useMemo(() => realtimeSuggestions(summary, daily), [summary, daily]);
  const hasDevices = user?.nest_connected || user?.smartcar_connected;

  // ─── Optimizer state ───
  const [optState, setOptState] = useState<OptimizerState | null>(null);
  const [plan, setPlan] = useState<OptimizerPlan | null>(null);
  const [logEntries, setLogEntries] = useState<OptimizerLogEntry[]>([]);
  const [autoMode, setAutoMode] = useState(true);
  const [toggling, setToggling] = useState(false);

  // Fetch optimizer data
  const fetchOptimizerData = useCallback(async () => {
    try {
      const [stateRes, planRes, logRes] = await Promise.all([
        api.getOptimizerState(),
        api.getOptimizerPlan(),
        api.getOptimizerLog(24),
      ]);
      setOptState(stateRes);
      setAutoMode(stateRes.auto_mode);
      setPlan(planRes.plan);
      setLogEntries(logRes.entries);
    } catch {
      // Silently fail — optimizer may not be running yet
    }
  }, []);

  useEffect(() => {
    fetchOptimizerData();
    const interval = setInterval(fetchOptimizerData, 60000); // Refresh every 60s
    return () => clearInterval(interval);
  }, [fetchOptimizerData]);

  // Update optimizer controls (debounced save to backend)
  const updateControl = useCallback(async (updates: Partial<OptimizerState>) => {
    // Optimistic local update
    setOptState(prev => prev ? { ...prev, ...updates } : prev);
    try {
      await api.updateOptimizerState(updates as Record<string, unknown>);
    } catch {
      // Revert on error by refetching
      fetchOptimizerData();
    }
  }, [fetchOptimizerData]);

  // Toggle auto mode
  async function toggleAutoMode() {
    if (toggling) return;
    setToggling(true);
    const newMode = !autoMode;
    setAutoMode(newMode);

    try {
      if (newMode) {
        await api.updateOptimizerState({ auto_mode: true, disabled_until: null });
        // Trigger immediate optimization
        await api.triggerOptimizer();
        await fetchOptimizerData();
      } else {
        // Default: disable until tomorrow 9 AM
        const tomorrow9am = new Date();
        tomorrow9am.setDate(tomorrow9am.getDate() + 1);
        tomorrow9am.setHours(9, 0, 0, 0);
        await api.updateOptimizerState({
          auto_mode: false,
          disabled_until: tomorrow9am.toISOString(),
        });
      }
    } catch {
      setAutoMode(!newMode); // Revert on error
    } finally {
      setToggling(false);
    }
  }

  // ─── Build schedule lines from plan for device cards ───
  let pwSchedule: string | undefined;
  let nestSchedule: string | undefined;
  let evSchedule: string | undefined;

  if (plan && autoMode) {
    // Find first PW action
    const pwCharge = plan.hours.find(h => h.pw_action === "charge");
    const pwDischarge = plan.hours.find(h => h.pw_action === "discharge");
    if (pwCharge && pwDischarge) {
      pwSchedule = `Charging → discharge at <strong class="text-gray-300">${fmtHour(pwDischarge.hour)}</strong> for peak`;
    } else if (pwDischarge) {
      pwSchedule = `Discharging at <strong class="text-gray-300">${fmtHour(pwDischarge.hour)}</strong>`;
    }

    // Find HVAC actions
    const precool = plan.hours.find(h => h.hvac_action === "precool");
    const eco = plan.hours.find(h => h.hvac_action === "eco");
    if (precool && eco) {
      nestSchedule = `Pre-cool to <strong class="text-gray-300">${precool.hvac_setpoint_f}°F at ${fmtHour(precool.hour)}</strong> → eco at ${fmtHour(eco.hour)}`;
    } else if (precool) {
      nestSchedule = `Pre-cool to <strong class="text-gray-300">${precool.hvac_setpoint_f}°F at ${fmtHour(precool.hour)}</strong>`;
    }

    // Find EV actions
    const evCharge = plan.hours.find(h => h.ev_action === "charge");
    if (evCharge) {
      const evEnd = plan.hours.filter(h => h.ev_action === "charge").pop();
      evSchedule = `Charge <strong class="text-gray-300">${fmtHour(evCharge.hour)}–${fmtHour((evEnd?.hour ?? evCharge.hour) + 1)}</strong> from solar`;
    }
  }

  // ─── Plan summary text ───
  const planSummary = plan
    ? `${plan.total_solar_kwh > 30 ? "☀️ Good solar day" : plan.total_solar_kwh > 15 ? "⛅ Moderate solar" : "☁️ Low solar day"} (${plan.total_solar_kwh.toFixed(0)} kWh predicted).`
    : null;

  const currentHour = new Date().getHours();

  return (
    <div className="space-y-5">

      {/* ═══ AUTO MODE TOGGLE ═══ */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {/* Toggle */}
          <button onClick={toggleAutoMode} disabled={toggling}
            className={`relative w-11 h-6 rounded-full transition-all duration-300 shrink-0 ${
              autoMode ? "bg-yellow-400 shadow-[0_0_16px_rgba(234,179,8,0.15)]" : "bg-gray-700"
            }`}>
            <div className={`absolute top-[2px] left-[2px] w-5 h-5 bg-white rounded-full shadow transition-transform duration-300 ${autoMode ? "translate-x-5" : ""}`} />
          </button>
          <div>
            <div className="text-sm font-semibold">Auto Mode</div>
            <div className="text-[10px] text-gray-500">
              {autoMode ? "Optimizing your energy" : "Paused — manual control"}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ AUTO MODE CONTENT ═══ */}
      {autoMode && (
        <>
          {/* Today's Plan */}
          {plan && (
            <section>
              <SectionLabel icon={<Clock size={12} className="text-gray-400" />}>
                Today&apos;s Plan
              </SectionLabel>
              <div className="bg-[#111827] rounded-xl p-3.5 border border-white/[0.04] relative overflow-hidden">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />
                {planSummary && (
                  <p className="text-[13px] text-gray-400 leading-relaxed mb-3">
                    <span className="text-gray-200 font-semibold">{planSummary.split("(")[0]}</span>
                    ({planSummary.split("(")[1]}
                  </p>
                )}
                <TimelineBar segments={plan.timeline} currentHour={currentHour} />
              </div>
            </section>
          )}

          {/* Devices (with schedule footers + inline controls) */}
          {hasDevices && (
            <section>
              <SectionLabel icon={<Battery size={12} className="text-gray-400" />}>
                Devices
              </SectionLabel>
              <div className="space-y-2.5">
                <PowerwallCard
                  summary={summary}
                  scheduleLine={pwSchedule}
                  reservePct={optState?.pw_reserve_pct}
                  onReserveChange={v => updateControl({ pw_reserve_pct: v })}
                />
                <NestCard
                  scheduleLine={nestSchedule}
                  readOnly
                  comfortMin={optState?.comfort_min_f}
                  comfortMax={optState?.comfort_max_f}
                  onComfortMinChange={v => updateControl({ comfort_min_f: v })}
                  onComfortMaxChange={v => updateControl({ comfort_max_f: v })}
                />
                <BMWCard
                  scheduleLine={evSchedule}
                  evMinPct={optState?.ev_min_pct}
                  evMaxPct={optState?.ev_max_pct}
                  onEvMinChange={v => updateControl({ ev_min_pct: v })}
                  onEvMaxChange={v => updateControl({ ev_max_pct: v })}
                />
              </div>
            </section>
          )}

          {/* Activity Log */}
          <section>
            <SectionLabel icon={<Activity size={12} className="text-gray-400" />}>
              Activity
            </SectionLabel>
            <div className="bg-[#111827] rounded-xl p-3.5 border border-white/[0.04] relative overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />
              <ActivityLog entries={logEntries} />
            </div>
          </section>

          {/* This Week */}
          {plan && (
            <section>
              <SectionLabel icon={<Zap size={12} className="text-gray-400" />}>
                This Week
              </SectionLabel>
              <div className="bg-[#111827] rounded-xl p-3.5 border border-white/[0.04] relative overflow-hidden">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-xs text-gray-400">Automations saved</span>
                  <span className="text-sm font-bold text-green-400">~${plan.total_savings_est.toFixed(2)}</span>
                </div>
              </div>
            </section>
          )}

          {/* No plan yet state */}
          {!plan && (
            <div className="bg-[#111827] rounded-xl p-4 border border-white/[0.04] text-center">
              <RefreshCw size={20} className="text-yellow-400/60 mx-auto mb-2 animate-spin" />
              <p className="text-sm text-gray-400">Generating your first optimization plan...</p>
              <p className="text-xs text-gray-600 mt-1">This usually takes a minute after enabling Auto mode.</p>
            </div>
          )}
        </>
      )}

      {/* ═══ MANUAL MODE CONTENT ═══ */}
      {!autoMode && (
        <>
          {/* Right Now */}
          {realtime.length > 0 && (
            <section>
              <SectionLabel icon={<Zap size={12} className="text-yellow-400" />}>
                Right Now
              </SectionLabel>
              <div className="space-y-2.5">
                {realtime.map(s => <SuggestionCard key={s.id} s={s} />)}
              </div>
            </section>
          )}

          {/* Devices (with controls, no schedule) */}
          {hasDevices && (
            <section>
              <SectionLabel icon={<Battery size={12} className="text-gray-400" />}>
                Devices
              </SectionLabel>
              <div className="space-y-2.5">
                <PowerwallCard summary={summary} />
                <NestCard />
                <BMWCard />
              </div>
            </section>
          )}

          {/* Empty state */}
          {!hasDevices && realtime.length === 0 && (
            <div className="bg-[#111827] rounded-xl p-4 border border-white/[0.04] text-center">
              <Lightbulb size={24} className="text-yellow-400/60 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No recommendations right now.</p>
              <p className="text-xs text-gray-600 mt-1">Connect your devices in Settings to get started.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
