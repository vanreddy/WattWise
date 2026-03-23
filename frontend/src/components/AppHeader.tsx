"use client";

import { useAuth } from "./AuthProvider";

export default function AppHeader() {
  const { user, logout } = useAuth();

  return (
    <header className="border-b border-gray-800 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <a href="/" className="hover:opacity-80 flex items-center">
          <img src="/icon.svg" alt="SelfPower" className="h-8 w-8 rounded" />
          <span className="ml-2 text-lg sm:text-xl font-bold tracking-tight">
            <span className="text-white">Self</span>
            <span className="text-green-400">Power</span>
          </span>
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
