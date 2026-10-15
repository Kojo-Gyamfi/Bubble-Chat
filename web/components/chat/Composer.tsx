"use client";

import { ArrowUp, ClipboardPaste } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MAX_MESSAGE_CHARS } from "@/lib/chat/schema";

const MAX_HEIGHT_PX = 208;

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
}

export interface ComposerHandle {
  /** Replaces the draft and puts the cursor at the end, ready to keep typing. */
  setDraft(text: string): void;
}

export function Composer({
  ref,
  onSend,
  disabled,
  readClipboard,
  compact = false,
  placeholder = "Message Bubble",
}: {
  ref?: Ref<ComposerHandle>;
  onSend: (text: string) => void;
  disabled?: boolean;
  /** Shows a paste button that inserts the clipboard text (bubble overlay). */
  readClipboard?: () => Promise<string>;
  /** Overlay variant: tighter, no footnote. */
  compact?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    setDraft(draft) {
      setText(draft);
      // After the new value renders: focus (opens the keyboard on phones) with the caret at the end.
      requestAnimationFrame(() => {
        const el = input.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
    },
  }));
  const trimmed = text.trim();
  const canSend = !disabled && trimmed.length > 0;
  const nearLimit = text.length > MAX_MESSAGE_CHARS * 0.9;

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

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!canSend) return;
    onSend(trimmed);
    setText("");
  }

  async function paste() {
    const clip = (await readClipboard?.())?.trim();
    if (!clip) return;
    setText((t) => (t ? `${t}${/\s$/.test(t) ? "" : " "}${clip}` : clip).slice(0, MAX_MESSAGE_CHARS));
    input.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends on devices with a real keyboard; on touch it inserts a newline.
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (e.key === "Enter" && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) {
      submit(e);
    }
  }

  return (
    <div
      className={`mx-auto w-full max-w-3xl ${compact ? "px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]" : "px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6"}`}
    >
      <form
        onSubmit={submit}
        className={`flex items-end gap-1.5 border border-border bg-background shadow-composer transition-colors focus-within:border-foreground/25 dark:bg-surface ${compact ? "rounded-3xl p-1.5" : "rounded-[28px] p-2"}`}
      >
        {readClipboard && (
          <button
            type="button"
            onClick={paste}
            aria-label="Paste from clipboard"
            title="Paste from clipboard"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface hover:text-foreground dark:hover:bg-surface-strong"
          >
            <ClipboardPaste className="size-[18px]" aria-hidden="true" />
          </button>
        )}
        <textarea
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={MAX_MESSAGE_CHARS}
          rows={1}
          placeholder={placeholder}
          aria-label="Message"
          enterKeyHint="send"
          className={`min-h-9 flex-1 resize-none bg-transparent py-1.5 text-base leading-6 outline-none placeholder:text-muted-foreground ${readClipboard ? "px-1" : "px-3"}`}
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send"
          title="Send"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-85 disabled:bg-surface-strong disabled:text-muted-foreground disabled:opacity-100"
        >
          <ArrowUp className="size-5" strokeWidth={2.25} aria-hidden="true" />
        </button>
      </form>
      {nearLimit ? (
        <p className="mt-1.5 px-3 text-right text-xs text-muted-foreground">
          {text.length.toLocaleString()} / {MAX_MESSAGE_CHARS.toLocaleString()}
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
