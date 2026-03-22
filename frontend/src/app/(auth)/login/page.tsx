"use client";

import { useState, type FormEvent } from "react";
import { login } from "@/lib/auth";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[70vh]">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
        <div className="flex flex-col items-center gap-2">
          <img src="/icon.svg" alt="WattWise" className="h-14 w-14 rounded-lg" />
          <h2 className="text-2xl font-bold">
            <span className="text-white">Watt</span>
            <span className="text-green-400">Wise</span>
          </h2>
          <p className="text-gray-500 text-sm">Sign in to your account</p>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-yellow-500"
          />
          <input
            type="password"
            placeholder="Password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-yellow-500"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-yellow-500 text-gray-950 font-semibold rounded py-2 text-sm hover:bg-yellow-400 disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>

        <p className="text-center text-gray-600 text-xs">
          New to WattWise?{" "}
          <a href="/onboard" className="text-yellow-500 hover:text-yellow-400">
            Get started
          </a>
        </p>
      </form>
    </div>
  );
}
