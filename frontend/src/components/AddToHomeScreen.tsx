"use client";

import { useEffect, useState } from "react";

/* ─── Types ──────────────────────────────────── */

// Chrome/Android fires this before the native install prompt
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Platform = "ios" | "android" | "other";

/* ─── Helpers ────────────────────────────────── */

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/android/i.test(ua)) return "android";
  return "other";
}

function isAlreadyInstalled(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches;
}

const SHOWN_KEY = "selfpower_a2hs_shown";

/* ─── Component ──────────────────────────────── */

interface Props {
  onDone: () => void;
}

export default function AddToHomeScreen({ onDone }: Props) {
  const [platform, setPlatform] = useState<Platform>("other");
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleAndroidInstall = async () => {
    if (!deferredPrompt) return;
    setInstalling(true);
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted" || outcome === "dismissed") {
      markShownAndDone();
    }
    setInstalling(false);
  };

  const markShownAndDone = () => {
    try { localStorage.setItem(SHOWN_KEY, "1"); } catch { /* ignore */ }
    onDone();
  };

  // App icon
  const AppIcon = () => (
    <div className="w-20 h-20 rounded-[22px] overflow-hidden shadow-2xl shadow-black/60 ring-1 ring-white/10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-192.png" alt="SelfPower" className="w-full h-full" />
    </div>
  );

  // ── iOS prompt ──────────────────────────────
  if (platform === "ios") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-end bg-gray-950/95 backdrop-blur-sm px-5 pb-10">
        <div className="w-full max-w-sm">
          {/* Card */}
          <div className="bg-gray-900 border border-gray-700/60 rounded-3xl overflow-hidden">
            {/* Top section */}
            <div className="flex flex-col items-center pt-8 pb-6 px-6 text-center">
              <AppIcon />
              <h2 className="text-xl font-bold text-white mt-5 mb-1">Add SelfPower to your Home Screen</h2>
              <p className="text-sm text-gray-400 leading-relaxed">
                Get the full app experience — launch instantly, no browser bar.
              </p>
            </div>

            {/* Steps */}
            <div className="border-t border-gray-800 px-6 py-5 space-y-4">
              <Step n={1}>
                Tap the{" "}
                <span className="inline-flex items-center gap-1 text-blue-400 font-medium">
                  <ShareIcon /> Share
                </span>{" "}
                button at the bottom of your browser
              </Step>
              <Step n={2}>
                Scroll down and tap{" "}
                <span className="font-semibold text-white">"Add to Home Screen"</span>
              </Step>
              <Step n={3}>
                Tap <span className="font-semibold text-white">"Add"</span> in the top right
              </Step>
            </div>
          </div>

          {/* Skip */}
          <button
            onClick={markShownAndDone}
            className="w-full mt-4 text-sm text-gray-500 hover:text-gray-400 transition-colors py-2"
          >
            Maybe later
          </button>
        </div>
      </div>
    );
  }

  // ── Android prompt ──────────────────────────
  if (platform === "android") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gray-950/95 backdrop-blur-sm px-5">
        <div className="w-full max-w-sm bg-gray-900 border border-gray-700/60 rounded-3xl overflow-hidden">
          <div className="flex flex-col items-center pt-8 pb-6 px-6 text-center">
            <AppIcon />
            <h2 className="text-xl font-bold text-white mt-5 mb-1">Add SelfPower to your Home Screen</h2>
            <p className="text-sm text-gray-400 leading-relaxed">
              Launch instantly from your home screen like a native app.
            </p>
          </div>

          <div className="border-t border-gray-800 px-5 py-5 flex flex-col gap-3">
            <button
              onClick={handleAndroidInstall}
              disabled={!deferredPrompt || installing}
              className="w-full bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-950 font-bold rounded-xl py-3 text-sm transition-colors"
            >
              {installing ? "Installing…" : "Add to Home Screen"}
            </button>
            <button
              onClick={markShownAndDone}
              className="w-full text-sm text-gray-500 hover:text-gray-400 transition-colors py-2"
            >
              Maybe later
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

/* ─── Sub-components ─────────────────────────── */

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-800 border border-gray-700 text-xs font-bold text-gray-400 flex items-center justify-center mt-0.5">
        {n}
      </span>
      <p className="text-sm text-gray-300 leading-relaxed">{children}</p>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
      <polyline points="16 6 12 2 8 6"/>
      <line x1="12" y1="2" x2="12" y2="15"/>
    </svg>
  );
}
