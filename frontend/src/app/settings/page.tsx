"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  createInvite,
  linkTelegram,
  unlinkTelegram,
  disconnectTesla,
} from "@/lib/auth";

/* ─── Toggle switch ─── */
function Toggle({
  on,
  disabled,
  onChange,
}: {
  on: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onChange}
      className={`
        relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full
        border-2 border-transparent transition-colors duration-200 ease-in-out
        focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 focus:ring-offset-gray-950
        disabled:opacity-50 disabled:cursor-not-allowed
        ${on ? "bg-green-500" : "bg-gray-600"}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow
          transform transition duration-200 ease-in-out
          ${on ? "translate-x-5" : "translate-x-0"}
        `}
      />
    </button>
  );
}

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

  // Invite state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);

  // Telegram state
  const [tgCode, setTgCode] = useState("");
  const [tgError, setTgError] = useState<string | null>(null);
  const [tgSuccess, setTgSuccess] = useState<string | null>(null);
  const [tgLoading, setTgLoading] = useState(false);

  // Tesla state
  const [teslaError, setTeslaError] = useState<string | null>(null);
  const [teslaLoading, setTeslaLoading] = useState(false);

  // Confirmation modals
  const [confirmTesla, setConfirmTesla] = useState(false);
  const [confirmTelegram, setConfirmTelegram] = useState(false);

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

  const isTelegramConnected = !!user.telegram_chat_id;
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

  // ─── Telegram handlers ───
  function handleTelegramToggle() {
    if (isTelegramConnected) {
      setConfirmTelegram(true);
    }
    // If not connected, the linking form is shown below
  }

  async function confirmDisconnectTelegram() {
    setTgError(null);
    setTgSuccess(null);
    setTgLoading(true);
    try {
      await unlinkTelegram();
      setTgSuccess("Telegram disconnected.");
      refreshUser?.();
      setConfirmTelegram(false);
    } catch (err) {
      setTgError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setTgLoading(false);
    }
  }

  async function handleLinkTelegram(e: React.FormEvent) {
    e.preventDefault();
    setTgError(null);
    setTgSuccess(null);
    setTgLoading(true);
    try {
      await linkTelegram(tgCode);
      setTgSuccess("Telegram connected! You will now receive notifications.");
      setTgCode("");
      refreshUser?.();
    } catch (err) {
      setTgError(err instanceof Error ? err.message : "Failed to link Telegram");
    } finally {
      setTgLoading(false);
    }
  }

  // ─── Invite handler ───
  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    setInviteLink(null);
    setInviteLoading(true);
    try {
      const { invite_id } = await createInvite(inviteEmail);
      const base = window.location.origin;
      setInviteLink(`${base}/signup?invite=${invite_id}`);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Failed to create invite");
    } finally {
      setInviteLoading(false);
    }
  }

  function copyLink() {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink);
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
      <ConfirmModal
        open={confirmTelegram}
        title="Disconnect Telegram?"
        message="You will no longer receive daily reports, weekly summaries, or real-time solar surplus alerts via Telegram."
        confirmLabel="Disconnect"
        onConfirm={confirmDisconnectTelegram}
        onCancel={() => setConfirmTelegram(false)}
        loading={tgLoading}
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
                    ? "Polling active"
                    : "Disconnected — no data collection"}
                </p>
              </div>
              <Toggle
                on={isTeslaConnected}
                disabled={teslaLoading || (!isTeslaConnected && user.role !== "primary")}
                onChange={handleTeslaToggle}
              />
            </div>
          </div>

          {teslaError && (
            <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded px-3 py-2">
              {teslaError}
            </div>
          )}

          {!isTeslaConnected && (
            <p className="text-xs text-gray-600">
              To reconnect, run the Tesla OAuth flow from the server CLI.
            </p>
          )}
        </section>

        {/* ─── Section 2: User Profile & Telegram ─── */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            User
          </h3>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Email</span>
              <span>{user.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Role</span>
              <span className="capitalize">{user.role}</span>
            </div>

            {/* Telegram row with toggle */}
            <div className="flex justify-between items-center">
              <div>
                <span className="text-gray-500">Telegram</span>
                <p className="text-xs text-gray-600 mt-0.5">
                  {isTelegramConnected
                    ? "Receiving notifications"
                    : "Not connected"}
                </p>
              </div>
              <Toggle
                on={isTelegramConnected}
                disabled={tgLoading}
                onChange={handleTelegramToggle}
              />
            </div>
          </div>

          {/* Telegram linking form (shown when not connected) */}
          {!isTelegramConnected && (
            <div className="space-y-3">
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
                <p className="text-sm text-gray-400">
                  Connect Telegram to receive daily reports and real-time alerts:
                </p>
                <ol className="text-sm text-gray-500 list-decimal list-inside space-y-1">
                  <li>
                    Open{" "}
                    <a
                      href="https://t.me/watt_wise_bot"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-yellow-500 hover:text-yellow-400"
                    >
                      @watt_wise_bot
                    </a>{" "}
                    in Telegram
                  </li>
                  <li>
                    Send <code className="bg-gray-800 px-1 rounded">/start</code>
                  </li>
                  <li>Enter the 6-digit code below</li>
                </ol>
              </div>

              <form onSubmit={handleLinkTelegram} className="flex gap-2">
                <input
                  type="text"
                  required
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  placeholder="6-digit code"
                  value={tgCode}
                  onChange={(e) =>
                    setTgCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  className="w-32 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-center tracking-widest focus:outline-none focus:border-yellow-500"
                />
                <button
                  type="submit"
                  disabled={tgLoading || tgCode.length !== 6}
                  className="bg-yellow-500 text-gray-950 font-semibold rounded px-4 py-2 text-sm hover:bg-yellow-400 disabled:opacity-50"
                >
                  {tgLoading ? "Verifying..." : "Connect"}
                </button>
              </form>
            </div>
          )}

          {tgError && (
            <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded px-3 py-2">
              {tgError}
            </div>
          )}
          {tgSuccess && (
            <div className="bg-green-900/30 border border-green-800 text-green-300 text-sm rounded px-3 py-2">
              {tgSuccess}
            </div>
          )}
        </section>

        {/* ─── Section 3: Invite (primary only) ─── */}
        {user.role === "primary" && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              Invite a User
            </h3>
            <p className="text-sm text-gray-500">
              Invite one additional user to view your energy dashboard and
              receive Telegram notifications. They will create their own login.
            </p>

            <form onSubmit={handleInvite} className="flex gap-2">
              <input
                type="email"
                required
                placeholder="Their email address"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-yellow-500"
              />
              <button
                type="submit"
                disabled={inviteLoading}
                className="bg-yellow-500 text-gray-950 font-semibold rounded px-4 py-2 text-sm hover:bg-yellow-400 disabled:opacity-50 whitespace-nowrap"
              >
                {inviteLoading ? "Creating..." : "Create Invite"}
              </button>
            </form>

            {inviteError && (
              <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded px-3 py-2">
                {inviteError}
              </div>
            )}

            {inviteLink && (
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
                <p className="text-sm text-gray-400">
                  Share this link with your invitee. It expires in 7 days.
                </p>
                <div className="flex gap-2 items-center">
                  <code className="flex-1 bg-gray-950 text-yellow-400 text-xs rounded px-3 py-2 break-all select-all">
                    {inviteLink}
                  </code>
                  <button
                    onClick={copyLink}
                    className="text-gray-400 hover:text-gray-200 text-sm border border-gray-700 rounded px-3 py-2 whitespace-nowrap"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}
