"use client";

import type { User } from "firebase/auth";
import { type ReactNode, useState } from "react";
import { Composer } from "@/components/chat/Composer";
import { MessageList } from "@/components/chat/MessageList";
import { FullScreenSpinner } from "@/components/Spinner";
import { bridge } from "@/lib/bridge";
import { useChat, useConversations } from "@/lib/chat/hooks";
import { useIsNative } from "@/lib/overlay-auth";

/**
 * Compact chat for the bubble's ~320×480 WebView panel: a 40 px bar, the
 * most recent conversation, and a composer with a paste button. No sidebar,
 * no <select>/alert/confirm (they crash in a Service-context WebView).
 */
export function OverlayChat({ user }: { user: User }) {
  const native = useIsNative();
  const { conversations, error } = useConversations(user.uid);
  // undefined = not chosen yet → latch onto the most recent conversation once
  // the list loads (so new chats from the PWA don't yank the panel away).
  const [selected, setSelected] = useState<string | null | undefined>(undefined);
  if (selected === undefined && conversations) setSelected(conversations[0]?.id ?? null);
  const activeId = selected ?? null;
  const { messages, loading, busy, send } = useChat(user, activeId);

  if (error === "permission-denied") {
    return (
      <OverlayNotice title="Not on the guest list">
        {user.email ?? "This account"} isn&apos;t allowed to use this chat.
      </OverlayNotice>
    );
  }
  if (selected === undefined) return <FullScreenSpinner />;

  const title = conversations?.find((c) => c.id === activeId)?.title ?? "New chat";

  async function handleSend(text: string) {
    const id = await send(text);
    if (id !== activeId) setSelected(id);
  }

  return (
    <div className="flex h-dvh flex-col bg-background pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-border pr-1 pl-3">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
        <BarButton label="New chat" onClick={() => setSelected(null)}>
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </BarButton>
        {native && (
          <BarButton label="Minimize" onClick={() => bridge.minimize()}>
            <path d="M6 12h12" strokeLinecap="round" />
          </BarButton>
        )}
      </header>

      <MessageList
        messages={messages}
        loading={loading}
        empty={<p className="mt-16 text-center text-sm opacity-50">Ask me anything.</p>}
      />
      <Composer onSend={handleSend} disabled={busy} readClipboard={bridge.readClipboard} />
    </div>
  );
}

function BarButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex size-8 items-center justify-center rounded-lg hover:bg-muted"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

export function OverlayNotice({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <main className="safe-area flex h-dvh items-center justify-center text-center">
      <div className="max-w-xs space-y-2">
        <h1 className="font-semibold">{title}</h1>
        <p className="text-sm opacity-70">{children}</p>
        {action}
      </div>
    </main>
  );
}
