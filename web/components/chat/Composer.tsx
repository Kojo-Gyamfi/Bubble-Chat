"use client";

import { type FormEvent, type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { MAX_MESSAGE_CHARS } from "@/lib/chat/schema";

const MAX_HEIGHT_PX = 200;

export function Composer({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const trimmed = text.trim();
  const canSend = !disabled && trimmed.length > 0;

  // Auto-grow up to MAX_HEIGHT_PX.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!canSend) return;
    onSend(trimmed);
    setText("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends on devices with a real keyboard; on touch it inserts a newline.
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (e.key === "Enter" && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) {
      submit(e);
    }
  }

  return (
    <form onSubmit={submit} className="border-t border-border bg-background px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={MAX_MESSAGE_CHARS}
          rows={1}
          placeholder="Message"
          aria-label="Message"
          className="min-h-10 flex-1 resize-none rounded-2xl border border-border bg-muted px-4 py-2 text-base outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-white transition disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {text.length > MAX_MESSAGE_CHARS * 0.9 && (
        <p className="mx-auto mt-1 max-w-3xl text-right text-xs opacity-60">
          {text.length} / {MAX_MESSAGE_CHARS}
        </p>
      )}
    </form>
  );
}
