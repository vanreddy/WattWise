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
  Snowflake,
  Leaf,
  RefreshCw,
  Battery,
} from "lucide-react";
import type { ReactNode } from "react";
import type { SummaryResponse, DailySummary, Alert, NestDevice, SmartcarVehicle, SmartcarVehicleStatus } from "@/lib/api";
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

/* ─── Helper: °C → °F ─── */
function cToF(c: number | null): number | null {
  if (c === null || c === undefined) return null;
  return Math.round(c * 9 / 5 + 32);
}

function fToDisplay(f: number | null): string {
  if (f === null) return "—";
  return `${f}°F`;
}

/* ─── Device Cards (unified style) ─────────── */

function PowerwallCard({ summary }: { summary: SummaryResponse | null }) {
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

  const statusColor = isCharging
    ? "text-green-400"
    : isDischarging
    ? "text-yellow-400"
    : "text-gray-500";

  const pct = Math.max(0, Math.min(100, battery_pct));
  const kwhEstimate = (pct / 100 * 13.5).toFixed(1); // 13.5 kWh Powerwall capacity

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
    </div>
  );
}

/* ─── Nest: single thermostat mini card ─── */

function NestThermostatMini({
  device,
  onRefresh,
}: {
  device: NestDevice;
  onRefresh: () => void;
}) {
  const [commanding, setCommanding] = useState(false);

  const ambientF = cToF(device.ambient_temp_c);
  const coolSetpointF = cToF(device.cool_setpoint_c);
  const heatSetpointF = cToF(device.heat_setpoint_c);
  const isEco = device.eco_mode === "MANUAL_ECO";
  const hvacStatus = device.hvac_status || "OFF";
  const mode = device.mode || "OFF";

  // What's the active setpoint?
  const setpointF = mode === "HEAT" ? heatSetpointF
    : (mode === "COOL" || mode === "HEATCOOL") ? coolSetpointF
    : null;

  const hvacColor =
    hvacStatus === "COOLING" ? "text-blue-400"
    : hvacStatus === "HEATING" ? "text-orange-400"
    : "text-gray-500";

  const hvacIcon =
    hvacStatus === "COOLING" ? "❄️"
    : hvacStatus === "HEATING" ? "🔥"
    : isEco ? "🍃"
    : "";

  const hvacLabel =
    hvacStatus === "COOLING" ? "Cooling"
    : hvacStatus === "HEATING" ? "Heating"
    : isEco ? "Eco"
    : "Idle";

  async function adjustTemp(delta: number) {
    if (commanding) return;
    const currentSetpoint = coolSetpointF ?? 72;
    const newTemp = currentSetpoint + delta;
    setCommanding(true);
    try {
      await api.nestSetCool(device.device_id, newTemp);
      onRefresh();
    } catch {
      // Silently fail
    } finally {
      setCommanding(false);
    }
  }

  async function toggleEco() {
    if (commanding) return;
    setCommanding(true);
    try {
      await api.nestSetEco(device.device_id, !isEco);
      onRefresh();
    } catch {
      // Silently fail
    } finally {
      setCommanding(false);
    }
  }

  // Extract room name: strip "Nest Thermostat" prefix if present
  const shortName = device.display_name
    ?.replace(/nest\s*(thermostat)?\s*[-–—]?\s*/i, "")
    .trim() || device.display_name || "Thermostat";

  return (
    <div>
      <div className="bg-white/[0.02] border border-white/[0.04] rounded-[10px] p-3 h-full flex flex-col">
        {/* Room name + HVAC status */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-gray-300">{shortName}</span>
          <span className={`text-[9px] font-medium ${hvacColor}`}>
            {hvacIcon} {hvacLabel}
          </span>
        </div>

        {/* Current temp (big) + humidity */}
        <div className="mb-3">
          <span className="text-[26px] font-bold leading-none">{fToDisplay(ambientF)}</span>
          {device.humidity_pct != null && (
            <span className="text-[10px] text-gray-500 ml-1.5">{device.humidity_pct}%</span>
          )}
        </div>

        {/* Setpoint control: ▼ [target temp] ▲ */}
        {mode !== "OFF" && !isEco && (
          <div className="flex items-center justify-between bg-white/[0.03] rounded-lg px-2 py-1.5 mb-2">
            <button
              onClick={() => adjustTemp(-1)}
              disabled={commanding}
              className="w-8 h-8 flex items-center justify-center rounded-md bg-white/[0.06] text-gray-300 text-sm font-bold hover:bg-white/[0.12] active:bg-white/[0.16] disabled:opacity-30 transition-colors"
            >
              <ChevronDown size={16} />
            </button>
            <div className="text-center">
              <div className="text-[10px] text-gray-500 leading-none">Set to</div>
              <div className="text-sm font-bold text-blue-400 leading-tight">
                {setpointF != null ? `${setpointF}°F` : "—"}
              </div>
            </div>
            <button
              onClick={() => adjustTemp(1)}
              disabled={commanding}
              className="w-8 h-8 flex items-center justify-center rounded-md bg-white/[0.06] text-gray-300 text-sm font-bold hover:bg-white/[0.12] active:bg-white/[0.16] disabled:opacity-30 transition-colors"
            >
              <ChevronUp size={16} />
            </button>
          </div>
        )}

        {/* Eco toggle */}
        <button
          onClick={toggleEco}
          disabled={commanding}
          className={`mt-auto w-full flex items-center justify-center gap-1.5 text-[10px] font-medium py-1.5 rounded-lg transition-all border ${
            isEco
              ? "text-green-400 bg-green-500/[0.08] border-green-500/20"
              : "text-gray-500 bg-white/[0.02] border-white/[0.06] hover:text-gray-300 hover:bg-white/[0.04]"
          } disabled:opacity-50`}
        >
          <Leaf size={11} />
          {isEco ? "Eco On" : "Eco Off"}
        </button>
      </div>
    </div>
  );
}

/* ─── Nest: card with grid of thermostats ─── */

function NestCard() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<NestDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.getNestDevices();
      if (res.devices.length > 0) {
        setDevices(res.devices);
        setError(null);
      } else {
        setError("No thermostats found");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.nest_connected) fetchStatus();
    else setLoading(false);
  }, [user?.nest_connected, fetchStatus]);

  if (!user?.nest_connected) return null;

  if (loading) {
    return (
      <div className="bg-[#111827] rounded-xl p-3.5 border border-white/[0.04]">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-[34px] h-[34px] rounded-[9px] bg-blue-500/10 flex items-center justify-center">
            <Thermometer size={16} className="text-blue-400" />
          </div>
          <span className="text-[13px] font-semibold">Nest Thermostats</span>
        </div>
        <p className="text-[10px] text-gray-500">Loading...</p>
      </div>
    );
  }

  if (error || devices.length === 0) {
    return (
      <div className="bg-[#111827] rounded-xl p-3.5 border border-white/[0.04]">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-[34px] h-[34px] rounded-[9px] bg-blue-500/10 flex items-center justify-center">
            <Thermometer size={16} className="text-blue-400" />
          </div>
          <span className="text-[13px] font-semibold">Nest Thermostats</span>
        </div>
        <p className="text-[10px] text-red-400">{error || "No devices"}</p>
      </div>
    );
  }

  return (
    <div className="bg-[#111827] rounded-xl p-3.5 border border-white/[0.04] relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-2.5">
        <div className="w-[34px] h-[34px] rounded-[9px] bg-blue-500/10 flex items-center justify-center">
          <Thermometer size={16} className="text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold">Nest Thermostats</div>
          <div className="text-[10px] text-gray-500">{devices.length} device{devices.length !== 1 ? "s" : ""}</div>
        </div>
        <button onClick={fetchStatus} className="text-gray-600 hover:text-gray-400 transition-colors">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* 2-column grid of thermostats */}
      <div className="grid grid-cols-2 gap-2.5">
        {devices.map((d) => (
          <NestThermostatMini key={d.device_id} device={d} onRefresh={fetchStatus} />
        ))}
      </div>
    </div>
  );
}

function BMWCard() {
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
        const v = vehicles.vehicles[0];
        setVehicle(v);
        const s = await api.getSmartcarVehicleStatus(v.vehicle_id);
        setStatus(s);
        setError(null);
      } else {
        setError("No vehicles found");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.smartcar_connected) fetchStatus();
    else setLoading(false);
  }, [user?.smartcar_connected, fetchStatus]);

  if (!user?.smartcar_connected) return null;

  if (loading) {
    return (
      <div className="bg-[#111827] rounded-xl p-3.5 border border-white/[0.04]">
        <div className="flex items-center gap-2">
          <div className="w-[34px] h-[34px] rounded-[9px] bg-purple-500/10 flex items-center justify-center">
            <Car size={16} className="text-purple-400" />
          </div>
          <span className="text-[13px] font-semibold">BMW iX</span>
        </div>
        <p className="text-[10px] text-gray-500 mt-2">Loading...</p>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="bg-[#111827] rounded-xl p-3.5 border border-white/[0.04]">
        <div className="flex items-center gap-2">
          <div className="w-[34px] h-[34px] rounded-[9px] bg-purple-500/10 flex items-center justify-center">
            <Car size={16} className="text-purple-400" />
          </div>
          <span className="text-[13px] font-semibold">BMW iX</span>
        </div>
        <p className="text-[10px] text-red-400 mt-2">{error || "No status"}</p>
      </div>
    );
  }

  const pct = status.percent_remaining != null ? Math.round(status.percent_remaining * 100) : null;
  const isPlugged = status.is_plugged_in;
  const chargeState = status.charge_state;
  const isCharging = chargeState === "CHARGING";
  const rangeMi = status.range_miles;
  const label = vehicle ? `${vehicle.year || ""} ${vehicle.make || "BMW"} ${vehicle.model || "iX"}`.trim() : "BMW iX";

  const plugStatus = isCharging ? "Charging" : isPlugged ? "⚡ Plugged in · Not charging" : "Unplugged";
  const plugColor = isCharging ? "text-green-400" : isPlugged ? "text-yellow-400" : "text-gray-500";

  async function handleChargeToggle() {
    if (!vehicle || commanding) return;
    setCommanding(true);
    try {
      if (isCharging) {
        await api.smartcarStopCharge(vehicle.vehicle_id);
      } else {
        await api.smartcarStartCharge(vehicle.vehicle_id);
      }
      await new Promise(r => setTimeout(r, 2000));
      await fetchStatus();
    } catch {
      // Silently fail
    } finally {
      setCommanding(false);
    }
  }

  return (
    <div className="bg-[#111827] rounded-xl p-3.5 border border-white/[0.04] relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />
      <div className="flex items-center gap-2.5 mb-2.5">
        <div className="w-[34px] h-[34px] rounded-[9px] bg-purple-500/10 flex items-center justify-center">
          <Car size={16} className="text-purple-400" />
        </div>
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
          <div
            className="h-full rounded-full bg-gradient-to-r from-purple-600 to-purple-400 transition-all duration-1000"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Charge control */}
      {isPlugged && (
        <div className="mt-2 pt-2 border-t border-white/[0.04]">
          <button
            onClick={handleChargeToggle}
            disabled={commanding}
            className={`w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold py-2 rounded-lg transition-all border ${
              isCharging
                ? "bg-red-500/[0.08] text-red-400 border-red-500/20 hover:bg-red-500/[0.14]"
                : "bg-green-500/[0.08] text-green-400 border-green-500/20 hover:bg-green-500/[0.14]"
            } disabled:opacity-50`}
          >
            {commanding ? (
              <RefreshCw size={12} className="animate-spin" />
            ) : isCharging ? (
              <><Plug size={12} /> Stop Charging</>
            ) : (
              <><PlugZap size={12} /> Start Charging</>
            )}
          </button>
        </div>
      )}

      {!isPlugged && (
        <p className="text-[10px] text-gray-600 text-center mt-2">Plug in to control charging</p>
      )}
    </div>
  );
}

/* ─── Real-time suggestions ──────────────────── */

function realtimeSuggestions(summary: SummaryResponse | null, daily: DailySummary[]): Suggestion[] {
  const out: Suggestion[] = [];
  const today = daily[0] ?? null;

  if (summary && summary.current.grid_w < -2000) {
    const kw = Math.abs(summary.current.grid_w / 1000);
    out.push({
      id: "solar-surplus",
      icon: <Sun size={20} />,
      iconBg: "bg-yellow-500/20 text-yellow-400",
      title: "Use your solar surplus",
      description: `You're exporting ${kw.toFixed(1)} kW to the grid at ~$0.07/kWh. That same energy powers your home at $0.32/kWh — 5x more valuable. Good time to run the dishwasher, laundry, or charge the EV.`,
      savings: `$${(kw * 0.25).toFixed(2)}/hr potential`,
      priority: "high",
    });
  }

  if (summary && summary.current.home_w > 3000) {
    out.push({
      id: "pre-cool",
      icon: <Thermometer size={20} />,
      iconBg: "bg-blue-500/20 text-blue-400",
      title: "Pre-cool before peak pricing",
      description: "Your home draw is high — likely running AC. Pre-cooling to 72°F by 3 PM lets you raise the thermostat during peak hours (4-9 PM) when electricity costs more.",
      savings: null,
      priority: "low",
    });
  }

  if (today && today.ev_peak_kwh > 0.5) {
    out.push({
      id: "ev-off-peak",
      icon: <Clock size={20} />,
      iconBg: "bg-purple-500/20 text-purple-400",
      title: "EV charged during peak yesterday",
      description: `You charged ${today.ev_peak_kwh.toFixed(1)} kWh during peak hours at $0.356/kWh. Scheduling for solar hours (10 am-2 pm) uses free solar instead.`,
      savings: `$${(today.ev_peak_kwh * (0.356 - 0.319)).toFixed(2)}/day savings`,
      priority: "high",
    });
  }

  if (today && today.battery_depletion_hour !== null && today.battery_depletion_hour < 21) {
    const h = today.battery_depletion_hour;
    const fmt = h >= 12 ? `${h === 12 ? 12 : h - 12} PM` : `${h} AM`;
    out.push({
      id: "battery-depletion",
      icon: <BatteryWarning size={20} />,
      iconBg: "bg-emerald-500/20 text-emerald-400",
      title: "Powerwall ran out early yesterday",
      description: `Your Powerwall depleted at ${fmt} — before the 9 PM peak end. Consider lowering the reserve to 10% to extend dispatch capacity through the full evening window.`,
      savings: null,
      priority: "medium",
    });
  }

  if (today && today.solar_generated_kwh > 10) {
    const ratio = today.solar_self_consumed_kwh / today.solar_generated_kwh;
    if (ratio < 0.5) {
      const wasted = (today.solar_generated_kwh - today.solar_self_consumed_kwh) * (0.32 - 0.07);
      out.push({
        id: "self-consumption",
        icon: <TrendingDown size={20} />,
        iconBg: "bg-orange-500/20 text-orange-400",
        title: "Low solar self-consumption yesterday",
        description: `Only ${(ratio * 100).toFixed(0)}% of solar was used at home. Shifting loads to midday could capture the rest instead of exporting at $0.07/kWh.`,
        savings: `$${wasted.toFixed(2)}/day opportunity`,
        priority: "medium",
      });
    }
  }

  return out;
}

/* ─── Shared UI pieces ───────────────────────── */

function PriorityBadge({ priority }: { priority: Suggestion["priority"] }) {
  const styles = {
    high:   "bg-red-500/15 text-red-400 border-red-500/30",
    medium: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    low:    "bg-gray-500/15 text-gray-400 border-gray-500/30",
  };
  return (
    <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${styles[priority]}`}>
      {priority}
    </span>
  );
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
          {s.savings && (
            <p className="text-[11px] font-semibold text-emerald-400 mt-1.5">{s.savings}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Section Label ─── */

function SectionLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 mb-2.5 flex items-center gap-1.5">
      {icon}
      {children}
    </h2>
  );
}

/* ─── Tab (Manual Mode) ────────────────────── */

export default function OptimizeTab({ summary, daily, alerts: _alerts }: Props) {
  const { user } = useAuth();
  const realtime = useMemo(() => realtimeSuggestions(summary, daily), [summary, daily]);

  const hasDevices = user?.nest_connected || user?.smartcar_connected;

  return (
    <div className="space-y-5">

      {/* ── Right Now (top of page) ── */}
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

      {/* ── Devices ── */}
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

      {/* ── Empty state ── */}
      {!hasDevices && realtime.length === 0 && (
        <div className="bg-[#111827] rounded-xl p-4 border border-white/[0.04] text-center">
          <Lightbulb size={24} className="text-yellow-400/60 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No recommendations right now.</p>
          <p className="text-xs text-gray-600 mt-1">Connect your devices in Settings to get started.</p>
        </div>
      )}

    </div>
  );
}
