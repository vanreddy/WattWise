"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { useSwipeable } from "react-swipeable";
import {
  registerPrimary,
  startTeslaAuth,
  completeTeslaAuth,
} from "@/lib/auth";
import { RingVisual, FlowVisual, InsightsVisual, SavingsVisual } from "@/components/landing/LandingVisuals";

/* ─── Step indicators ─── */
const STEPS = ["Account", "Tesla"] as const;

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-3 mb-10">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-3">
          <div className="flex flex-col items-center gap-1.5">
            <div
              className={`
                h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300
                ${i < current ? "bg-green-500 text-white shadow-lg shadow-green-500/30" : ""}
                ${i === current ? "bg-yellow-500 text-gray-950 shadow-lg shadow-yellow-500/30 scale-110" : ""}
                ${i > current ? "bg-gray-800/80 text-gray-500" : ""}
              `}
            >
              {i < current ? "\u2713" : i + 1}
            </div>
            <span className={`text-[10px] font-medium ${i <= current ? "text-gray-300" : "text-gray-600"}`}>
              {label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={`w-12 h-0.5 rounded-full -mt-5 ${i < current ? "bg-green-500" : "bg-gray-800"} transition-colors duration-300`}
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
    <div className="fixed inset-0 flex items-center justify-center bg-gray-950" style={{ height: "100dvh" }}>
    <div className="w-full max-w-md h-full flex flex-col">
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

  const inputCls = "w-full bg-gray-900/80 border border-gray-700/50 rounded-xl px-4 py-3 text-sm transition-all duration-200 focus:outline-none focus:border-yellow-500/70 focus:bg-gray-900";

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm mx-auto space-y-6 animate-fade-in-up">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">Create Your Account</h2>
        <p className="text-gray-500 text-sm">
          Set up your SelfPower login credentials
        </p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800/50 text-red-300 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <div className="space-y-3">
        <input type="email" placeholder="Email" required value={email}
          onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        <input type="password" placeholder="Password (min 6 characters)" required value={password}
          onChange={(e) => setPassword(e.target.value)} className={inputCls} />
        <input type="password" placeholder="Confirm password" required value={confirm}
          onChange={(e) => setConfirm(e.target.value)} className={inputCls} />

        <div className="border-t border-gray-800/50 pt-4 space-y-3">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Tesla Account Email</p>
          <label className="flex items-center gap-2.5 text-sm text-gray-400 cursor-pointer">
            <input type="checkbox" checked={sameEmail}
              onChange={(e) => setSameEmail(e.target.checked)} className="accent-yellow-500 w-4 h-4 rounded" />
            Same as login email
          </label>
          {!sameEmail && (
            <input type="email" placeholder="Tesla account email" required value={teslaEmail}
              onChange={(e) => setTeslaEmail(e.target.value)} className={inputCls} />
          )}
        </div>
      </div>

      <button type="submit" disabled={loading}
        className="w-full bg-yellow-500 text-gray-950 font-bold rounded-xl py-3.5 text-sm hover:bg-yellow-400 disabled:opacity-50 transition-all duration-200 active:scale-[0.98] shadow-lg shadow-yellow-500/20"
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
    <div className="w-full max-w-sm mx-auto space-y-6 animate-fade-in-up">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">Connect Tesla</h2>
        <p className="text-gray-500 text-sm">
          Link your Tesla account to start monitoring energy data
        </p>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800/50 text-red-300 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {siteName && (
        <div className="bg-green-900/30 border border-green-800/50 text-green-300 text-sm rounded-xl px-4 py-3 text-center">
          Connected to &ldquo;{siteName}&rdquo;
        </div>
      )}

      {phase === "init" && (
        <div className="space-y-5">
          <div className="bg-gray-900/60 border border-gray-800/50 rounded-2xl p-5 space-y-4">
            <p className="text-sm text-gray-400 leading-relaxed">
              This will open Tesla&rsquo;s login page in a new tab. After signing in:
            </p>
            <ol className="text-sm text-gray-500 space-y-2.5">
              <li className="flex gap-3 items-start">
                <span className="bg-gray-800 text-gray-400 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">1</span>
                Sign in with your Tesla credentials
              </li>
              <li className="flex gap-3 items-start">
                <span className="bg-gray-800 text-gray-400 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">2</span>
                Authorize SelfPower to access your energy data
              </li>
              <li className="flex gap-3 items-start">
                <span className="bg-gray-800 text-gray-400 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">3</span>
                Copy the redirect URL from your browser
              </li>
              <li className="flex gap-3 items-start">
                <span className="bg-gray-800 text-gray-400 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">4</span>
                Paste it back here
              </li>
            </ol>
          </div>

          <button onClick={handleStartAuth} disabled={loading}
            className="w-full bg-yellow-500 text-gray-950 font-bold rounded-xl py-3.5 text-sm hover:bg-yellow-400 disabled:opacity-50 transition-all duration-200 active:scale-[0.98] shadow-lg shadow-yellow-500/20"
          >
            {loading ? "Starting..." : "Connect Tesla Account"}
          </button>
        </div>
      )}

      {phase === "waiting" && (
        <form onSubmit={handleComplete} className="space-y-5">
          <div className="bg-gray-900/60 border border-gray-800/50 rounded-2xl p-5 space-y-2">
            <p className="text-sm text-gray-400 leading-relaxed">
              After signing into Tesla, copy the full URL from your browser&rsquo;s
              address bar and paste it below.
            </p>
            <p className="text-xs text-gray-600">
              It will look like: https://auth.tesla.com/void/callback?code=...
            </p>
          </div>

          <textarea required placeholder="Paste the redirect URL here..."
            value={redirectUrl} onChange={(e) => setRedirectUrl(e.target.value)} rows={3}
            className="w-full bg-gray-900/80 border border-gray-700/50 rounded-xl px-4 py-3 text-sm font-mono text-xs focus:outline-none focus:border-yellow-500/70 resize-none transition-all duration-200"
          />

          <button type="submit" disabled={loading || !redirectUrl.trim()}
            className="w-full bg-yellow-500 text-gray-950 font-bold rounded-xl py-3.5 text-sm hover:bg-yellow-400 disabled:opacity-50 transition-all duration-200 active:scale-[0.98] shadow-lg shadow-yellow-500/20"
          >
            {loading ? "Connecting..." : "Complete Connection"}
          </button>

          <button type="button" onClick={() => window.open(authUrl, "_blank")}
            className="w-full text-gray-500 hover:text-gray-300 text-xs py-1 transition-colors"
          >
            Open Tesla login again
          </button>
        </form>
      )}

      {phase === "completing" && !siteName && (
        <div className="text-center text-gray-500 text-sm py-8">
          <span className="inline-block w-5 h-5 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin mr-2" />
          Connecting to Tesla...
        </div>
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

  // Steps 1–2 = registration flow
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex items-start justify-center">
      <div className="w-full max-w-md px-6 py-10 sm:py-16">
        <StepBar current={step - 1} />

        {step === 1 && <AccountStep onNext={() => setStep(2)} />}
        {step === 2 && <TeslaStep onNext={handleFinish} />}
      </div>
    </div>
  );
}
