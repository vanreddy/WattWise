"use client";

import { useAuth } from "./AuthProvider";

export default function AppHeader() {
  const { user, logout } = useAuth();

  return (
    <header className="border-b border-gray-800 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <a href="/" className="text-lg sm:text-xl font-bold tracking-tight hover:opacity-80">
          <span className="text-yellow-400">⚡</span> WattWise
        </a>
        {user?.site_name && (
          <span className="text-gray-500 text-sm hidden sm:inline">
            — {user.site_name}
          </span>
        )}
      </div>
      {user && (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-500 hidden sm:inline">{user.email}</span>
          <a
            href="/settings"
            className="text-gray-400 hover:text-gray-200 text-sm"
          >
            Settings
          </a>
          <button
            onClick={logout}
            className="text-gray-400 hover:text-gray-200 text-sm"
          >
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}
