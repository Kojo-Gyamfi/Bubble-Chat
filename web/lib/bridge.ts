// Typed wrapper around `window.Android`, the @JavascriptInterface exposed by
// the bubble app (android/.../JsBridge.kt). Must match the Phase 3 contract in
// CLAUDE.md. Every call is safe in a normal browser: it falls back to a web
// API or does nothing.

interface AndroidBridge {
  /** Custom token saved at link time, or "". */
  getAuthToken(): string;
  getClipboard(): string;
  copyToClipboard(text: string): void;
  /** Collapse the panel back to the bubble. */
  minimize(): void;
  openInBrowser(url: string): void;
  getAppVersion(): string;
  /** Web side signed in with the custom token; native deletes it. */
  onLinked(): void;
  /** Signed-in account (email) for the app's Account section, or "" when signed out. Missing in app ≤ 1.0. */
  setAccount?(account: string): void;
}

declare global {
  interface Window {
    Android?: AndroidBridge;
  }
}

function native(): AndroidBridge | undefined {
  return typeof window === "undefined" ? undefined : window.Android;
}

function call<T>(fn: (android: AndroidBridge) => T, fallback: T): T {
  const android = native();
  if (!android) return fallback;
  try {
    return fn(android);
  } catch (err) {
    console.error("Android bridge call failed", err);
    return fallback;
  }
}

export const bridge = {
  isNative(): boolean {
    return native() !== undefined;
  },

  getAuthToken(): string {
    return call((a) => a.getAuthToken() ?? "", "");
  },

  onLinked(): void {
    call((a) => a.onLinked(), undefined);
  },

  setAccount(account: string): void {
    call((a) => a.setAccount?.(account), undefined);
  },

  minimize(): void {
    call((a) => a.minimize(), undefined);
  },

  getAppVersion(): string | null {
    return call((a) => a.getAppVersion() || null, null);
  },

  openInBrowser(url: string): void {
    if (native()) call((a) => a.openInBrowser(url), undefined);
    else window.open(url, "_blank", "noopener,noreferrer");
  },

  async readClipboard(): Promise<string> {
    if (native()) return call((a) => a.getClipboard() ?? "", "");
    try {
      return await navigator.clipboard.readText();
    } catch {
      return ""; // permission denied or unsupported
    }
  },

  async copyText(text: string): Promise<boolean> {
    if (native()) return call((a) => (a.copyToClipboard(text), true), false);
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  },
};
