"use client";

import { AlertCircle, ArrowDown } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "@/components/chat/Markdown";
import { CopyButton } from "@/components/ui";
import type { DisplayMessage } from "@/lib/chat/hooks";

const STICK_THRESHOLD_PX = 80;

export function MessageList({
  messages,
  loading,
  empty,
  compact = false,
}: {
  messages: DisplayMessage[];
  loading?: boolean;
  /** Shown (vertically centered) when the conversation has no messages. */
  empty?: ReactNode;
  /** Tighter spacing for the bubble overlay. */
  compact?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  };

  // Follow new chunks only while the user is already at the bottom.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
      stickToBottom.current = bottom;
      setAtBottom(bottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    if (stickToBottom.current) scrollToBottom();
  }, [messages]);

  // Keep the last message in view when the keyboard resizes the viewport.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) scrollToBottom();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const showEmpty = !loading && messages.length === 0 && empty;

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} className="h-full overflow-y-auto overscroll-contain">
        {showEmpty ? (
          <div className="flex h-full items-center justify-center px-4">{empty}</div>
        ) : (
          <div
            className={`mx-auto flex w-full max-w-3xl flex-col ${compact ? "gap-4 px-3 py-4 text-[15px]" : "gap-6 px-4 py-6 md:px-6"}`}
          >
            {messages.map((m) => (
              <MessageItem key={m.id} message={m} compact={compact} />
            ))}
          </div>
        )}
      </div>

      {!atBottom && !showEmpty && (
        <button
          type="button"
          onClick={() => scrollToBottom("smooth")}
          aria-label="Scroll to bottom"
          className="absolute bottom-3 left-1/2 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-md transition-colors hover:bg-surface animate-fade-up"
        >
          <ArrowDown className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function MessageItem({ message, compact }: { message: DisplayMessage; compact: boolean }) {
  if (message.role === "user") {
    return (
      <div className="group flex flex-col items-end">
        <div
          className={`max-w-[85%] rounded-3xl bg-surface whitespace-pre-wrap break-words ${compact ? "px-3.5 py-2" : "px-5 py-2.5"}`}
        >
          {message.content}
        </div>
        {!compact && !message.pending && (
          <div className="mt-1 flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <CopyButton text={message.content} label="Copy message" />
          </div>
        )}
      </div>
    );
  }

  if (message.pending === "error") {
    return (
      <div
        role="alert"
        className="flex items-start gap-2.5 rounded-2xl border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger animate-fade-up"
      >
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{message.content}</span>
      </div>
    );
  }

  if (message.pending === "streaming" && !message.content) {
    return (
      <div className="py-1.5" role="status" aria-label="Assistant is thinking">
        <span className="block size-3.5 rounded-full bg-foreground animate-thinking" />
      </div>
    );
  }

  return (
    <div className="group">
      <Markdown>{message.content}</Markdown>
      {!message.pending && (
        <div className="mt-1.5 -ml-1.5 flex items-center gap-0.5">
          <CopyButton text={message.content} />
        </div>
      )}
    </div>
  );
}
