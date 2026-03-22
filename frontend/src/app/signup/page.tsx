"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { register } from "@/lib/auth";

function SignupForm() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!inviteToken) {
    return (
      <div className="flex items-center justify-center min-h-[70vh]">
        <div className="text-center space-y-3">
          <h2 className="text-xl font-bold text-red-400">Invalid Invite Link</h2>
          <p className="text-gray-500 text-sm">
            You need a valid invite link to create an account.
          </p>
          <a href="/login" className="text-yellow-500 hover:text-yellow-400 text-sm">
            Already have an account? Sign in
          </a>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    try {
      await register(email, password, inviteToken!);
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[70vh]">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
        <div className="text-center">
          <h2 className="text-2xl font-bold">
            <span className="text-yellow-400">⚡</span> WattWise
          </h2>
          <p className="text-gray-500 text-sm mt-1">Create your account</p>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <input
            type="email"
            placeholder="Email (must match invite)"
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
          <input
            type="password"
            placeholder="Confirm password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-yellow-500"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-yellow-500 text-gray-950 font-semibold rounded py-2 text-sm hover:bg-yellow-400 disabled:opacity-50"
        >
          {loading ? "Creating account..." : "Create account"}
        </button>

        <p className="text-center text-gray-600 text-xs">
          Already have an account?{" "}
          <a href="/login" className="text-yellow-500 hover:text-yellow-400">
            Sign in
          </a>
        </p>
      </form>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[70vh] text-gray-500">
          Loading...
        </div>
      }
    >
      <SignupForm />
    </Suspense>
  );
}
