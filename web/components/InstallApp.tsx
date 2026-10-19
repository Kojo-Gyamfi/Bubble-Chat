"use client";

import { Download, Share, SquarePlus } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

/** Chromium's install event (not in lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Mode = "none" | "prompt" | "ios";

// Chrome fires beforeinstallprompt once per page load, possibly before any
// button has mounted, so keep it at module level. We don't preventDefault():
// Chrome may still show its own mini-infobar, and our button is a reliable
// second way in. iOS never fires it, so there we explain Add to Home Screen.
let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getMode(): Mode {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const standalone = window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
  if (installed || standalone || window.Android !== undefined) return "none";
  if (deferred) return "prompt";
  // iPadOS reports itself as a Mac; touch support gives it away.
  const ua = nav.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && nav.maxTouchPoints > 1)) return "ios";
  return "none";
}

/**
 * "Install app" entry. Renders nothing when installing isn't possible or the
 * app is already installed (standalone, or inside the bubble WebView).
 */
export function InstallApp({ variant }: { variant: "page" | "sidebar" }) {
  const mode = useSyncExternalStore(subscribe, getMode, () => "none" as Mode);
  const [showIosHelp, setShowIosHelp] = useState(false);

  if (mode === "none") return null;

  async function handleClick() {
    if (mode === "ios") {
      setShowIosHelp((v) => !v);
      return;
    }
    const event = deferred;
    if (!event) return;
    await event.prompt();
    const { outcome } = await event.userChoice;
    // The event can only be used once; Chrome fires a fresh one if it's still installable.
    if (outcome === "accepted") installed = true;
    deferred = null;
    notify();
  }

  const button =
    variant === "sidebar" ? (
      <button
        type="button"
        onClick={handleClick}
        aria-expanded={mode === "ios" ? showIosHelp : undefined}
        className="flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-sm transition-colors hover:bg-surface-strong/70"
      >
        <Download className="size-[18px] text-muted-foreground" aria-hidden="true" />
        Install app
      </button>
    ) : (
      <button
        type="button"
        onClick={handleClick}
        aria-expanded={mode === "ios" ? showIosHelp : undefined}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-surface text-[15px] font-medium transition-colors hover:bg-surface-strong"
      >
        <Download className="size-5" aria-hidden="true" />
        Install the app
      </button>
    );

  return (
    <div className="w-full">
      {button}
      {showIosHelp && (
        <ol
          className={`mt-2 space-y-2 rounded-2xl border border-border bg-background p-3 text-left text-sm animate-fade-up ${
            variant === "sidebar" ? "mx-0.5" : ""
          }`}
        >
          <li className="flex items-center gap-2">
            <span className="w-4 shrink-0 text-muted-foreground">1.</span>
            Tap <Share className="size-4 shrink-0 text-brand" aria-label="Share" /> Share in the browser bar
          </li>
          <li className="flex items-center gap-2">
            <span className="w-4 shrink-0 text-muted-foreground">2.</span>
            Choose <SquarePlus className="size-4 shrink-0" aria-hidden="true" />
            <span className="font-medium">Add to Home Screen</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="w-4 shrink-0 text-muted-foreground">3.</span>
            Open Bubble from your home screen
          </li>
        </ol>
      )}
    </div>
  );
}
