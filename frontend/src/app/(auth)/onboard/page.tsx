"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { useSwipeable } from "react-swipeable";
import {
  registerPrimary,
  startTeslaAuth,
  completeTeslaAuth,
  linkTelegram,
} from "@/lib/auth";
import { RingVisual, FlowVisual, InsightsVisual, SavingsVisual } from "@/components/landing/LandingVisuals";

/* ─── Step indicators ─── */
const STEPS = ["Account", "Tesla", "Telegram"] as const;

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div
            className={`
              h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold
              ${i < current ? "bg-green-500 text-white" : ""}
              ${i === current ? "bg-yellow-500 text-gray-950" : ""}
              ${i > current ? "bg-gray-800 text-gray-500" : ""}
            `}
          >
            {i < current ? "\u2713" : i + 1}
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={`w-8 h-0.5 ${i < current ? "bg-green-500" : "bg-gray-800"}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/* ─── Slide data ─── */
const SLIDES = [
  {
    heading: ["Maximize ", "self-powering", ""],
    description: "Minimize your dependence on the grid by intelligently optimizing your solar and powerwall.",
    Visual: RingVisual,
  },
  {
    heading: ["Track your ", "energy flow", ""],
    description: "Track solar, powerwall, and grid flowing through your home in real time.",
    Visual: FlowVisual,
  },
  {
    heading: ["", "AI", " suggestions to optimize your energy"],
    description: "Smart recommendations and alerts that optimize your energy automatically.",
    Visual: InsightsVisual,
  },
  {
    heading: ["", "Lower bills", " for electricity"],
    description: "Know exactly how much you save with solar and powerwall every day.",
    Visual: SavingsVisual,
  },
];

/* ─── Step 0: Landing Carousel ─── */
function LandingCarousel({ onNext }: { onNext: () => void }) {
  const [slide, setSlide] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);

  const goTo = useCallback((idx: number) => {
    setSlide(Math.max(0, Math.min(SLIDES.length - 1, idx)));
    setAutoPlay(false);
  }, []);

  // Auto-advance every 5s
  useEffect(() => {
    if (!autoPlay) return;
    const interval = setInterval(() => {
      setSlide((s) => (s + 1) % SLIDES.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [autoPlay]);

  const handlers = useSwipeable({
    onSwipedLeft: () => goTo(slide + 1),
    onSwipedRight: () => goTo(slide - 1),
    delta: 50,
    trackMouse: true,
  });

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-950" style={{ height: "100dvh" }}>
      {/* Slide track — swipeable area */}
      <div className="flex-1 overflow-hidden relative" {...handlers}>
        {SLIDES.map((s, i) => (
          <div
            key={i}
            className="absolute inset-0 flex flex-col px-8 transition-all duration-500 ease-out"
            style={{
              transform: `translateX(${(i - slide) * 100}%)`,
              opacity: i === slide ? 1 : 0.3,
            }}
          >
            {/* Text — top */}
            <div className="pt-12 sm:pt-16 space-y-3">
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white leading-tight">
                {s.heading[0]}<span className="text-green-400">{s.heading[1]}</span>{s.heading[2]}
              </h1>
              <p className="text-base text-gray-400 leading-relaxed max-w-xs">
                {s.description}
              </p>
            </div>
            {/* Visual — center fill */}
            <div className="flex-1 flex items-center justify-center">
              <s.Visual active={slide === i} />
            </div>
          </div>
        ))}
      </div>

      {/* Pagination dots + buttons */}
      <div className="px-6 pb-8 pt-4 space-y-5" style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>
        {/* Dots */}
        <div className="flex justify-center gap-2">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`rounded-full transition-all duration-300 ${
                i === slide ? "w-6 h-2 bg-yellow-500" : "w-2 h-2 bg-gray-700"
              }`}
            />
          ))}
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <a
            href="/login"
            className="flex-1 text-center border border-gray-600 text-gray-100 rounded-xl py-3.5 font-semibold text-sm hover:bg-gray-900 transition-colors"
          >
            Log in
          </a>
          <button
            onClick={onNext}
            className="flex-1 bg-yellow-500 text-gray-950 rounded-xl py-3.5 font-bold text-sm hover:bg-yellow-400 transition-colors shadow-lg shadow-yellow-500/20"
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Step 1: Create Account ─── */
function AccountStep({
  onNext,
}: {
  onNext: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [teslaEmail, setTeslaEmail] = useState("");
  const [sameEmail, setSameEmail] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    const tEmail = sameEmail ? email : teslaEmail;
    if (!tEmail) {
      setError("Tesla email is required");
      return;
    }

    setLoading(true);
    try {
      await registerPrimary(email, password, tEmail);
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm mx-auto space-y-5">
      <div className="text-center space-y-1">
        <h2 className="text-xl font-bold">Create Your Account</h2>
        <p className="text-gray-500 text-sm">
          Set up your SelfPower login credentials
        </p>
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
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2.5 text-sm focus:outline-none focus:border-yellow-500"
        />
        <input
          type="password"
          placeholder="Password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2.5 text-sm focus:outline-none focus:border-yellow-500"
        />
        <input
          type="password"
          placeholder="Confirm password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2.5 text-sm focus:outline-none focus:border-yellow-500"
        />

        <div className="border-t border-gray-800 pt-3 space-y-3">
          <p className="text-xs text-gray-500">Tesla Account Email</p>
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={sameEmail}
              onChange={(e) => setSameEmail(e.target.checked)}
              className="accent-yellow-500"
            />
            Same as login email
          </label>
          {!sameEmail && (
            <input
              type="email"
              placeholder="Tesla account email"
              required
              value={teslaEmail}
              onChange={(e) => setTeslaEmail(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2.5 text-sm focus:outline-none focus:border-yellow-500"
            />
          )}
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-yellow-500 text-gray-950 font-semibold rounded py-2.5 text-sm hover:bg-yellow-400 disabled:opacity-50"
      >
        {loading ? "Creating account..." : "Continue"}
      </button>
    </form>
  );
}

/* ─── Step 2: Connect Tesla ─── */
function TeslaStep({ onNext }: { onNext: () => void }) {
  const [phase, setPhase] = useState<"init" | "waiting" | "completing">("init");
  const [authUrl, setAuthUrl] = useState("");
  const [state, setState] = useState("");
  const [codeVerifier, setCodeVerifier] = useState("");
  const [redirectUrl, setRedirectUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [siteName, setSiteName] = useState<string | null>(null);

  async function handleStartAuth() {
    setError(null);
    setLoading(true);
    try {
      const data = await startTeslaAuth();
      if ("status" in data && data.status === "already_connected") {
        onNext();
        return;
      }
      if ("authorization_url" in data) {
        setAuthUrl(data.authorization_url);
        setState(data.state);
        setCodeVerifier(data.code_verifier);
        // Open Tesla auth in new tab
        window.open(data.authorization_url, "_blank");
        setPhase("waiting");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Tesla auth");
    } finally {
      setLoading(false);
    }
  }

  async function handleComplete(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setPhase("completing");
    try {
      const result = await completeTeslaAuth(redirectUrl, state, codeVerifier);
      setSiteName(result.site_name);
      // Brief success display before advancing
      setTimeout(() => onNext(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tesla authentication failed");
      setPhase("waiting");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm mx-auto space-y-5">
      <div className="text-center space-y-1">
        <h2 className="text-xl font-bold">Connect Tesla</h2>
        <p className="text-gray-500 text-sm">
          Link your Tesla account to start monitoring energy data
        </p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded px-3 py-2">
          {error}
        </div>
      )}

      {siteName && (
        <div className="bg-green-900/30 border border-green-800 text-green-300 text-sm rounded px-3 py-2 text-center">
          Connected to &ldquo;{siteName}&rdquo;
        </div>
      )}

      {phase === "init" && (
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
            <p className="text-sm text-gray-400">
              This will open Tesla&rsquo;s login page in a new tab. After signing in:
            </p>
            <ol className="text-sm text-gray-500 list-decimal list-inside space-y-1">
              <li>Sign in with your Tesla credentials</li>
              <li>Authorize SelfPower to access your energy data</li>
              <li>Copy the redirect URL from your browser</li>
              <li>Paste it back here</li>
            </ol>
          </div>

          <button
            onClick={handleStartAuth}
            disabled={loading}
            className="w-full bg-yellow-500 text-gray-950 font-semibold rounded py-2.5 text-sm hover:bg-yellow-400 disabled:opacity-50"
          >
            {loading ? "Starting..." : "Connect Tesla Account"}
          </button>
        </div>
      )}

      {phase === "waiting" && (
        <form onSubmit={handleComplete} className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-2">
            <p className="text-sm text-gray-400">
              After signing into Tesla, copy the full URL from your browser&rsquo;s
              address bar and paste it below.
            </p>
            <p className="text-xs text-gray-600">
              It will look like: https://auth.tesla.com/void/callback?code=...
            </p>
          </div>

          <textarea
            required
            placeholder="Paste the redirect URL here..."
            value={redirectUrl}
            onChange={(e) => setRedirectUrl(e.target.value)}
            rows={3}
            className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2.5 text-sm font-mono text-xs focus:outline-none focus:border-yellow-500 resize-none"
          />

          <button
            type="submit"
            disabled={loading || !redirectUrl.trim()}
            className="w-full bg-yellow-500 text-gray-950 font-semibold rounded py-2.5 text-sm hover:bg-yellow-400 disabled:opacity-50"
          >
            {loading ? "Connecting..." : "Complete Connection"}
          </button>

          <button
            type="button"
            onClick={() => window.open(authUrl, "_blank")}
            className="w-full text-gray-500 hover:text-gray-300 text-xs py-1"
          >
            Open Tesla login again
          </button>
        </form>
      )}

      {phase === "completing" && !siteName && (
        <div className="text-center text-gray-500 text-sm py-4">
          Connecting to Tesla...
        </div>
      )}
    </div>
  );
}

/* ─── Step 3: Connect Telegram ─── */
function TelegramStep({ onFinish }: { onFinish: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await linkTelegram(code);
      setSuccess(true);
      setTimeout(() => onFinish(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link Telegram");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm mx-auto space-y-5">
      <div className="text-center space-y-1">
        <h2 className="text-xl font-bold">Connect Telegram</h2>
        <p className="text-gray-500 text-sm">
          Get daily reports and real-time alerts via Telegram
        </p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-300 text-sm rounded px-3 py-2">
          {error}
        </div>
      )}

      {success ? (
        <div className="bg-green-900/30 border border-green-800 text-green-300 text-sm rounded px-3 py-2 text-center">
          Telegram connected! Setting up your account...
        </div>
      ) : (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
            <ol className="text-sm text-gray-500 list-decimal list-inside space-y-2">
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
                Send{" "}
                <code className="bg-gray-800 px-1.5 py-0.5 rounded text-gray-300">
                  /start
                </code>
              </li>
              <li>Enter the 6-digit code below</li>
            </ol>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="text"
              required
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              placeholder="6-digit code"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2.5 text-sm text-center tracking-[0.3em] text-lg font-mono focus:outline-none focus:border-yellow-500"
            />
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="w-full bg-yellow-500 text-gray-950 font-semibold rounded py-2.5 text-sm hover:bg-yellow-400 disabled:opacity-50"
            >
              {loading ? "Verifying..." : "Connect Telegram"}
            </button>
          </form>

          <button
            onClick={onFinish}
            className="w-full text-gray-600 hover:text-gray-400 text-xs py-1"
          >
            Skip for now — you can connect later in Settings
          </button>
        </>
      )}
    </div>
  );
}

/* ─── Main onboarding page ─── */
export default function OnboardPage() {
  const [step, setStep] = useState(0);

  function handleFinish() {
    window.location.href = "/setup";
  }

  // Step 0 = landing carousel (full screen, no chrome)
  if (step === 0) {
    return <LandingCarousel onNext={() => setStep(1)} />;
  }

  // Steps 1–3 = registration flow
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 px-4 py-8">
      <StepBar current={step - 1} />

      {step === 1 && <AccountStep onNext={() => setStep(2)} />}
      {step === 2 && <TeslaStep onNext={() => setStep(3)} />}
      {step === 3 && <TelegramStep onFinish={handleFinish} />}
    </div>
  );
}
