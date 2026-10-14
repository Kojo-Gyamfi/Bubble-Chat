"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { Markdown } from "@/components/chat/Markdown";
import type { DisplayMessage } from "@/lib/chat/hooks";

const STICK_THRESHOLD_PX = 80;

export function MessageList({
  messages,
  loading,
  empty,
}: {
  messages: DisplayMessage[];
  loading?: boolean;
  empty?: React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Follow new chunks only while the user is already at the bottom.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Keep the last message in view when the keyboard resizes the viewport.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-4">
        {!loading && messages.length === 0 && empty}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: DisplayMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2 whitespace-pre-wrap text-white">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.pending === "error") {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">
        {message.content}
      </div>
    );
  }

  if (message.pending === "streaming" && !message.content) {
    return <TypingDots />;
  }

  return (
    <div className="max-w-full">
      <Markdown>{message.content}</Markdown>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex gap-1 py-2" aria-label="Assistant is typing">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-2 animate-bounce rounded-full bg-current opacity-40"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}
