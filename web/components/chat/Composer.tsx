"use client";

import {
  ArrowUp,
  Camera,
  ClipboardPaste,
  Image as ImageIcon,
  Loader2,
  Mic,
  MonitorSmartphone,
  Plus,
  Square,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { prepareImage } from "@/lib/chat/image";
import { type ChatImage, MAX_MESSAGE_CHARS } from "@/lib/chat/schema";
import { useVoiceInput } from "@/lib/voice";

const MAX_HEIGHT_PX = 208;

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
}

export interface ComposerHandle {
  /** Replaces the draft and puts the cursor at the end, ready to keep typing. */
  setDraft(text: string): void;
  /** Adds text to the end of the draft (shared text, voice input). */
  appendText(text: string): void;
  /** Attaches a photo (data URL or file), replacing any current one. */
  attachImage(source: string | Blob): void;
  /** Shows a short error under the composer. */
  showError(message: string): void;
}

/** Where photos come from. Browsers use file inputs; the bubble app asks Android. */
export type PhotoSource =
  | { kind: "browser" }
  | { kind: "native"; pick: (source: "camera" | "gallery") => void; captureScreen?: () => void }
  | { kind: "none" };

export function Composer({
  ref,
  onSend,
  onStop,
  busy = false,
  readClipboard,
  photos = { kind: "browser" },
  notice,
  compact = false,
  placeholder = "Message Bubble",
}: {
  ref?: Ref<ComposerHandle>;
  onSend: (text: string, image?: ChatImage) => void;
  /** While `busy`, the send button becomes Stop. */
  onStop?: () => void;
  busy?: boolean;
  /** Adds "Paste" to the + menu (bubble overlay). */
  readClipboard?: () => Promise<string>;
  photos?: PhotoSource;
  /** Small hint under the box, e.g. "3 messages left today". */
  notice?: string | null;
  /** Overlay variant: tighter, no footnote. */
  compact?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<ChatImage | "loading" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const menuRoot = useRef<HTMLDivElement>(null);
  const attachRun = useRef(0);

  const focusEnd = () =>
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });

  const append = (addition: string) => {
    const clean = addition.trim();
    if (!clean) return;
    setText((t) => (t ? `${t}${/\s$/.test(t) ? "" : " "}${clean}` : clean).slice(0, MAX_MESSAGE_CHARS));
    focusEnd();
  };

  function attach(source: string | Blob) {
    const run = ++attachRun.current;
    setError(null);
    setImage("loading");
    prepareImage(source)
      .then((prepared) => run === attachRun.current && setImage(prepared))
      .catch((err: unknown) => {
        if (run !== attachRun.current) return;
        setImage(null);
        setError(err instanceof Error ? err.message : String(err));
      });
  }

  useImperativeHandle(ref, () => ({
    setDraft(draft) {
      setText(draft);
      // After the new value renders: focus (opens the keyboard on phones) with the caret at the end.
      focusEnd();
    },
    appendText: append,
    attachImage: attach,
    showError: setError,
  }));

  const voice = useVoiceInput(append);

  const trimmed = text.trim();
  const hasImage = image !== null && image !== "loading";
  const canSend = !busy && image !== "loading" && (trimmed.length > 0 || hasImage);
  const nearLimit = text.length > MAX_MESSAGE_CHARS * 0.9;
  const hint = error ?? voice.error ?? notice;

  // Auto-grow up to MAX_HEIGHT_PX.
  useLayoutEffect(() => {
    autosize(input.current);
  }, [text]);

  // Re-measure when the width changes. The bubble's WebView loads this page
  // while detached (near-zero width), so the first measurement is far too tall.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return; // ignore our own height changes
      width = el.clientWidth;
      autosize(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Close the + menu on outside tap / Escape (custom menu: no <select> in the bubble).
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (!menuRoot.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!canSend) return;
    onSend(trimmed, hasImage ? image : undefined);
    setText("");
    setImage(null);
    setError(null);
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // picking the same file again should still fire
    if (file) attach(file);
  }

  async function paste() {
    append((await readClipboard?.()) ?? "");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends on devices with a real keyboard; on touch it inserts a newline.
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (e.key === "Enter" && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) {
      submit(e);
    }
  }

  type MenuAction = "camera" | "gallery" | "screen" | "paste";
  const menuItems: { action: MenuAction; icon: typeof Camera; label: string }[] = [];
  if (photos.kind !== "none") {
    menuItems.push(
      { action: "camera", icon: Camera, label: "Take photo" },
      { action: "gallery", icon: ImageIcon, label: "Choose photo" },
    );
  }
  if (photos.kind === "native" && photos.captureScreen) {
    menuItems.push({ action: "screen", icon: MonitorSmartphone, label: "Ask about my screen" });
  }
  if (readClipboard) menuItems.push({ action: "paste", icon: ClipboardPaste, label: "Paste text" });

  function runMenu(action: MenuAction) {
    setMenuOpen(false);
    if (action === "paste") return void paste();
    if (photos.kind === "native") {
      if (action === "screen") photos.captureScreen?.();
      else photos.pick(action);
    } else if (photos.kind === "browser") {
      (action === "camera" ? cameraInput : galleryInput).current?.click();
    }
  }

  const iconButton =
    "flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface hover:text-foreground dark:hover:bg-surface-strong";

  return (
    <div
      className={`mx-auto w-full max-w-3xl ${compact ? "px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]" : "px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6"}`}
    >
      {photos.kind === "browser" && (
        <>
          <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
          <input ref={galleryInput} type="file" accept="image/*" hidden onChange={onFile} />
        </>
      )}
      <form
        onSubmit={submit}
        className={`border border-border bg-background shadow-composer transition-colors focus-within:border-foreground/25 dark:bg-surface ${compact ? "rounded-3xl p-1.5" : "rounded-[28px] p-2"}`}
      >
        {image !== null && (
          <div className="relative mb-1.5 ml-1 size-16 animate-fade-up">
            {image === "loading" ? (
              <div className="flex size-16 items-center justify-center rounded-xl bg-surface-strong" aria-label="Preparing photo">
                <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- local data URL preview
              <img src={image.thumbnail} alt="Attached photo" className="size-16 rounded-xl border border-border object-cover" />
            )}
            <button
              type="button"
              onClick={() => {
                attachRun.current++;
                setImage(null);
              }}
              aria-label="Remove photo"
              className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full border border-border bg-background text-foreground shadow"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-1">
          {menuItems.length > 0 && (
            <div ref={menuRoot} className="relative">
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute bottom-full left-0 z-20 mb-2 w-56 overflow-hidden rounded-2xl border border-border bg-background p-1.5 shadow-lg animate-fade-up dark:bg-surface"
                >
                  {menuItems.map(({ action, icon: Icon, label }) => (
                    <button
                      key={action}
                      type="button"
                      role="menuitem"
                      onClick={() => runMenu(action)}
                      className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-surface dark:hover:bg-surface-strong"
                    >
                      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-label="Add photo or more"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title="Add"
                className={iconButton}
              >
                <Plus className="size-5" aria-hidden="true" />
              </button>
            </div>
          )}

          <textarea
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={MAX_MESSAGE_CHARS}
            rows={1}
            placeholder={voice.listening ? "Listening…" : placeholder}
            aria-label="Message"
            enterKeyHint="send"
            className={`min-h-9 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-base leading-6 outline-none placeholder:text-muted-foreground ${menuItems.length ? "px-1" : "px-3"}`}
          />

          {voice.supported && (
            <button
              type="button"
              onClick={voice.listening ? voice.stop : voice.start}
              aria-label={voice.listening ? "Stop listening" : "Voice input"}
              aria-pressed={voice.listening}
              title={voice.listening ? "Stop listening" : "Voice input"}
              className={voice.listening ? `${iconButton} bg-danger/10 text-danger animate-pulse` : iconButton}
            >
              <Mic className="size-[18px]" aria-hidden="true" />
            </button>
          )}

          {busy && onStop ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop"
              title="Stop"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-85"
            >
              <Square className="size-3.5" fill="currentColor" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send"
              title="Send"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-85 disabled:bg-surface-strong disabled:text-muted-foreground disabled:opacity-100"
            >
              <ArrowUp className="size-5" strokeWidth={2.25} aria-hidden="true" />
            </button>
          )}
        </div>
      </form>
      {nearLimit ? (
        <p className="mt-1.5 px-3 text-right text-xs text-muted-foreground">
          {text.length.toLocaleString()} / {MAX_MESSAGE_CHARS.toLocaleString()}
        </p>
      ) : hint ? (
        <p
          role={error || voice.error ? "alert" : "status"}
          className={`mt-1.5 px-3 text-center text-xs ${error || voice.error ? "text-danger" : "text-muted-foreground"}`}
        >
          {hint}
        </p>
      ) : (
        !compact && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Bubble can make mistakes<span className="hidden sm:inline">. Check important info</span>.
            <span className="mx-1.5 opacity-60">·</span>
            Built by <span className="font-medium text-foreground/70">Nana Kojo</span>
          </p>
        )
      )}
    </div>
  );
}

/** "3 messages left today" once it gets low; the reset time in the user's timezone at 0. */
export function messagesLeftNotice(left: number | null): string | null {
  if (left === null || left > 5) return null;
  if (left === 0) {
    const now = new Date();
    const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return `No messages left today. More at ${reset.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
  }
  return `${left} message${left === 1 ? "" : "s"} left today`;
}
