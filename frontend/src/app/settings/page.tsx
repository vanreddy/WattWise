"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { createInvite } from "@/lib/auth";

export default function SettingsPage() {
  const { user, isLoading } = useAuth();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);

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
    <div className="max-w-lg mx-auto px-4 py-8 space-y-8">
      <h2 className="text-xl font-bold">Account Settings</h2>

      {/* Account info */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
          Your Profile
        </h3>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-2 text-sm">
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
            <span className={user.telegram_chat_id ? "" : "text-gray-600"}>
              {user.telegram_chat_id ? "Connected" : "Not connected"}
            </span>
          </div>
        </div>
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
