"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  disconnectTesla,
  changePassword,
  startTeslaAuth,
  completeTeslaAuth,
} from "@/lib/auth";

/* ─── Confirmation modal ─── */
function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  loading,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm w-full space-y-4 shadow-xl">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm text-gray-400">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={loading}
            className="text-sm text-gray-400 hover:text-gray-200 px-4 py-2 rounded border border-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="text-sm bg-red-600 hover:bg-red-500 text-white font-semibold px-4 py-2 rounded disabled:opacity-50"
          >
            {loading ? "Disconnecting..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { user, isLoading, refreshUser } = useAuth();

  // Tesla state
  const [teslaError, setTeslaError] = useState<string | null>(null);
  const [teslaLoading, setTeslaLoading] = useState(false);
  const [teslaReauthPhase, setTeslaReauthPhase] = useState<"idle" | "waiting" | "completing">("idle");
  const [teslaAuthUrl, setTeslaAuthUrl] = useState("");
  const [teslaState, setTeslaState] = useState("");
  const [teslaCodeVerifier, setTeslaCodeVerifier] = useState("");
  const [teslaRedirectUrl, setTeslaRedirectUrl] = useState("");

  // Password state
  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);
  const [pwLoading, setPwLoading] = useState(false);

  // Confirmation modals
  const [confirmTesla, setConfirmTesla] = useState(false);
  const [teslaSuccess, setTeslaSuccess] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-gray-500">
        Loading...
      </div>
    );
  }

  if (!user) {
    if (typeof window !== "undefined") window.location.href = "/login";
    return null;
  }

  const isTeslaConnected = user.tesla_connected;

  // ─── Tesla handlers ───
  function handleTeslaToggle() {
    if (isTeslaConnected) {
      setConfirmTesla(true);
    }
    // Connect flow would require Tesla OAuth — not implemented yet
  }

  async function confirmDisconnectTesla() {
    setTeslaError(null);
    setTeslaLoading(true);
    try {
      await disconnectTesla();
      refreshUser?.();
      setConfirmTesla(false);
    } catch (err) {
      setTeslaError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setTeslaLoading(false);
    }
  }

  // ─── Tesla reconnect handlers ───
  async function handleTeslaReconnect() {
    setTeslaError(null);
    setTeslaLoading(true);
    try {
      const data = await startTeslaAuth();
      if ("status" in data && data.status === "already_connected") {
        refreshUser?.();
        setTeslaReauthPhase("idle");
        return;
      }
      if ("authorization_url" in data) {
        setTeslaAuthUrl(data.authorization_url);
        setTeslaState(data.state);
        setTeslaCodeVerifier(data.code_verifier);
        window.open(data.authorization_url, "_blank");
        setTeslaReauthPhase("waiting");
      }
    } catch (err) {
      setTeslaError(err instanceof Error ? err.message : "Failed to start Tesla auth");
    } finally {
      setTeslaLoading(false);
    }
  }

  async function handleTeslaReauthComplete() {
    setTeslaError(null);
    setTeslaSuccess(false);
    setTeslaLoading(true);
    setTeslaReauthPhase("completing");
    try {
      const result = await completeTeslaAuth(teslaRedirectUrl, teslaState, teslaCodeVerifier);
      setTeslaSuccess(true);
      setTeslaReauthPhase("idle");
      setTeslaRedirectUrl("");
      // Delay refresh to show success message
      setTimeout(() => {
        refreshUser?.();
      }, 1500);
    } catch (err) {
      setTeslaError(err instanceof Error ? err.message : "Tesla reconnection failed");
      setTeslaReauthPhase("waiting");
    } finally {
      setTeslaLoading(false);
    }
  }

  // ─── Password handler ───
  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(null);

    if (newPw.length < 6) {
      setPwError("New password must be at least 6 characters");
      return;
    }
    if (newPw !== confirmPw) {
      setPwError("Passwords do not match");
      return;
    }

    setPwLoading(true);
    try {
      await changePassword(currentPw, newPw);
      setPwSuccess("Password changed successfully.");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setChangingPassword(false);
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setPwLoading(false);
    }
  }

  return (
    <>
      {/* Confirmation modals */}
      <ConfirmModal
        open={confirmTesla}
        title="Disconnect Tesla?"
        message="This will stop all energy data polling. Your existing data will be preserved, but no new data will be collected until you reconnect."
        confirmLabel="Disconnect"
        onConfirm={confirmDisconnectTesla}
        onCancel={() => setConfirmTesla(false)}
        loading={teslaLoading}
      />
      <div className="max-w-lg mx-auto px-4 py-8 space-y-10">
        <h2 className="text-xl font-bold">Settings</h2>

        {/* ─── Section 1: Account ─── */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            Account
          </h3>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Account Name</span>
              <span>{user.site_name || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Energy Site ID</span>
              <span className="font-mono text-xs text-gray-300">
                {user.energy_site_id || "—"}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <div>
                <span className="text-gray-500">Tesla Connection</span>
                <p className="text-xs text-gray-600 mt-0.5">
                  {isTeslaConnected
                    ? "Connected — polling active"
                    : "Disconnected — no data collection"}
                </p>
              </div>
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                isTeslaConnected
                  ? "bg-green-900/30 text-green-400"
                  : "bg-red-900/30 text-red-400"
              }`}>
                {isTeslaConnected ? "Active" : "Offline"}
              </span>
            </div>
          </div>

          {teslaError && (
            <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded px-3 py-2">
              {teslaError}
            </div>
          )}

          {/* Tesla Reconnect Flow */}
          {teslaSuccess && (
            <div className="bg-green-900/30 border border-green-800/50 text-green-300 text-sm rounded-xl px-4 py-3 text-center">
              ✓ Tesla reconnected successfully! Data polling will resume shortly.
            </div>
          )}

          {teslaReauthPhase === "idle" && !teslaSuccess && (
            <button
              onClick={handleTeslaReconnect}
              disabled={teslaLoading}
              className="w-full bg-yellow-500 text-gray-950 font-semibold rounded-xl py-2.5 text-sm hover:bg-yellow-400 disabled:opacity-50 transition-all"
            >
              {teslaLoading ? "Starting..." : "Reconnect Tesla"}
            </button>
          )}

          {teslaReauthPhase === "waiting" && (
            <div className="space-y-3">
              <div className="bg-gray-900/60 border border-gray-800/50 rounded-xl p-4 space-y-2">
                <p className="text-sm text-gray-400">
                  After signing into Tesla in the new tab, copy the full URL from your browser and paste it below.
                </p>
                <p className="text-xs text-gray-600">
                  It will look like: https://auth.tesla.com/void/callback?code=...
                </p>
              </div>
              <textarea
                placeholder="Paste the redirect URL here..."
                value={teslaRedirectUrl}
                onChange={(e) => setTeslaRedirectUrl(e.target.value)}
                rows={3}
                className="w-full bg-gray-900/80 border border-gray-700/50 rounded-xl px-4 py-3 text-xs font-mono focus:outline-none focus:border-yellow-500/70 resize-none"
              />
              <button
                onClick={handleTeslaReauthComplete}
                disabled={teslaLoading || !teslaRedirectUrl.trim()}
                className="w-full bg-yellow-500 text-gray-950 font-semibold rounded-xl py-2.5 text-sm hover:bg-yellow-400 disabled:opacity-50 transition-all"
              >
                {teslaLoading ? "Connecting..." : "Complete Reconnection"}
              </button>
              <button
                onClick={() => window.open(teslaAuthUrl, "_blank")}
                className="w-full text-gray-500 hover:text-gray-300 text-xs py-1"
              >
                Open Tesla login again
              </button>
            </div>
          )}

          {teslaReauthPhase === "completing" && (
            <div className="text-center text-gray-500 text-sm py-4">
              <span className="inline-block w-5 h-5 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin mr-2" />
              Reconnecting to Tesla...
            </div>
          )}
        </section>

        {/* ─── Section 2: User ─── */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            User
          </h3>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Email</span>
              <span>{user.email}</span>
            </div>

            {/* Password row */}
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Password</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-gray-400">
                  ••••••••
                </span>
                <button
                  onClick={() => setChangingPassword(!changingPassword)}
                  className="text-yellow-500 hover:text-yellow-400 text-xs"
                >
                  {changingPassword ? "Cancel" : "Change"}
                </button>
              </div>
            </div>
          </div>

          {/* Password change form */}
          {changingPassword && (
            <form onSubmit={handleChangePassword} className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
              <div className="space-y-2">
                <input
                  type="password"
                  required
                  placeholder="Current password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-yellow-500"
                />
                <input
                  type="password"
                  required
                  placeholder="New password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-yellow-500"
                />
                <input
                  type="password"
                  required
                  placeholder="Confirm new password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-yellow-500"
                />
              </div>
              <button
                type="submit"
                disabled={pwLoading}
                className="bg-yellow-500 text-gray-950 font-semibold rounded px-4 py-2 text-sm hover:bg-yellow-400 disabled:opacity-50"
              >
                {pwLoading ? "Saving..." : "Update Password"}
              </button>
            </form>
          )}

          {pwError && (
            <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded px-3 py-2">
              {pwError}
            </div>
          )}
          {pwSuccess && (
            <div className="bg-green-900/30 border border-green-800 text-green-300 text-sm rounded px-3 py-2">
              {pwSuccess}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
