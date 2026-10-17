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

  // Media and speech (app 0.2+). Results come back through takePending() after
  // a "bubble-native" {type: "pending"} event; speech end as {type: "tts-end"}.
  /** JSON NativeCapabilities. */
  getCapabilities?(): string;
  /** "camera" | "gallery": the panel hides while the system picker is open. */
  pickImage?(source: string): void;
  captureScreen?(): void;
  /** Document picker (app 0.4+): PDF, Word, text. */
  pickFile?(): void;
  startVoiceInput?(): void;
  /** JSON NativePending, or "" when there's nothing. */
  takePending?(): string;
  speak?(text: string): void;
  stopSpeaking?(): void;
}

export interface NativeCapabilities {
  photo: boolean;
  file: boolean;
  screen: boolean;
  voice: boolean;
  speech: boolean;
}

/** Things handed to the bubble from outside the page (share sheet, "Ask Bubble", pickers). */
export interface NativePending {
  /** Shared or selected text, to put in the composer. */
  text?: string;
  /** Speech-to-text result, appended to the composer. */
  voice?: string;
  /** Photo/screenshot as a JPEG data URL. */
  image?: string;
  /** Document picked or shared into the bubble. */
  file?: { name: string; mimeType: string; dataUrl: string };
  /** Something went wrong natively (e.g. no camera app). */
  error?: string;
}

export type NativeEvent = { type: "pending" } | { type: "tts-end" };

/** Events the bubble app dispatches on window as CustomEvent("bubble-native", { detail }). */
export function onNativeEvent(listener: (event: NativeEvent) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<NativeEvent>).detail);
  window.addEventListener("bubble-native", handler);
  return () => window.removeEventListener("bubble-native", handler);
}

const NO_CAPABILITIES: NativeCapabilities = { photo: false, file: false, screen: false, voice: false, speech: false };

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

  /** What this version of the bubble app can do (all false in a browser or an older app). */
  capabilities(): NativeCapabilities {
    const raw = call((a) => a.getCapabilities?.() ?? "", "");
    if (!raw) return NO_CAPABILITIES;
    try {
      return { ...NO_CAPABILITIES, ...(JSON.parse(raw) as Partial<NativeCapabilities>) };
    } catch {
      return NO_CAPABILITIES;
    }
  },

  pickImage(source: "camera" | "gallery"): void {
    call((a) => a.pickImage?.(source), undefined);
  },

  captureScreen(): void {
    call((a) => a.captureScreen?.(), undefined);
  },

  pickFile(): void {
    call((a) => a.pickFile?.(), undefined);
  },

  startVoiceInput(): void {
    call((a) => a.startVoiceInput?.(), undefined);
  },

  takePending(): NativePending | null {
    const raw = call((a) => a.takePending?.() ?? "", "");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as NativePending;
    } catch {
      return null;
    }
  },

  /** Native text-to-speech; false if this app version can't (use the browser's). */
  speak(text: string): boolean {
    return call((a) => (a.speak ? (a.speak(text), true) : false), false);
  },

  stopSpeaking(): void {
    call((a) => a.stopSpeaking?.(), undefined);
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
