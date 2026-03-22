"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { createInvite, linkTelegram, unlinkTelegram } from "@/lib/auth";

export default function SettingsPage() {
  const { user, isLoading } = useAuth();

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
  const [tgLinked, setTgLinked] = useState<boolean | null>(null); // null = use user data

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

  const isTelegramConnected = tgLinked ?? !!user.telegram_chat_id;

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

  async function handleLinkTelegram(e: React.FormEvent) {
    e.preventDefault();
    setTgError(null);
    setTgSuccess(null);
    setTgLoading(true);
    try {
      await linkTelegram(tgCode);
      setTgLinked(true);
      setTgSuccess("Telegram connected! You will now receive notifications.");
      setTgCode("");
    } catch (err) {
      setTgError(err instanceof Error ? err.message : "Failed to link Telegram");
    } finally {
      setTgLoading(false);
    }
  }

  async function handleUnlinkTelegram() {
    setTgError(null);
    setTgSuccess(null);
    setTgLoading(true);
    try {
      await unlinkTelegram();
      setTgLinked(false);
      setTgSuccess("Telegram disconnected.");
    } catch (err) {
      setTgError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setTgLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-8 space-y-8">
      <h2 className="text-xl font-bold">Account Settings</h2>

      {/* Account info */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
          Your Profile
        </h3>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-2 text-sm">
          {user.site_name && (
            <div className="flex justify-between">
              <span className="text-gray-500">Site</span>
              <span>{user.site_name}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-500">Email</span>
            <span>{user.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Role</span>
            <span className="capitalize">{user.role}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Telegram</span>
            <span className={isTelegramConnected ? "text-green-400" : "text-gray-600"}>
              {isTelegramConnected ? "Connected" : "Not connected"}
            </span>
          </div>
        </div>
      </section>

      {/* Telegram linking */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
          Telegram Notifications
        </h3>

        {isTelegramConnected ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              Your Telegram is connected. You receive daily reports, weekly
              summaries, and real-time solar surplus alerts.
            </p>
            <button
              onClick={handleUnlinkTelegram}
              disabled={tgLoading}
              className="text-red-400 hover:text-red-300 text-sm border border-red-800 rounded px-3 py-2 disabled:opacity-50"
            >
              {tgLoading ? "Disconnecting..." : "Disconnect Telegram"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
              <p className="text-sm text-gray-400">
                To receive notifications, connect your Telegram:
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
                onChange={(e) => setTgCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
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

      {/* Invite secondary user — primary only */}
      {user.role === "primary" && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            Invite a User
          </h3>
          <p className="text-sm text-gray-500">
            Invite one additional user to view your energy dashboard. They will
            create their own login and also receive Telegram notifications.
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
  );
}
