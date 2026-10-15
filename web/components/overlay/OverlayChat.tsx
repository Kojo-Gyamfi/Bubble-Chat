"use client";

import type { User } from "firebase/auth";
import { Minus, ShieldAlert, SquarePen } from "lucide-react";
import { useState } from "react";
import { Composer } from "@/components/chat/Composer";
import { EmptyState } from "@/components/chat/EmptyState";
import { MessageList } from "@/components/chat/MessageList";
import { FullScreenSpinner } from "@/components/Spinner";
import { IconButton, Logo, Notice } from "@/components/ui";
import { bridge } from "@/lib/bridge";
import { useChat, useConversations } from "@/lib/chat/hooks";
import { useIsNative } from "@/lib/overlay-auth";

/**
 * Compact chat for the bubble's ~320×480 WebView panel: a 44 px bar, the
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
      <Notice icon={ShieldAlert} tone="danger" title="Not on the guest list">
        {user.email ?? "This account"} isn&apos;t allowed to use this chat.
      </Notice>
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
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border pr-1 pl-3">
        <Logo className="size-5 shrink-0" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
        <IconButton icon={SquarePen} label="New chat" size="sm" onClick={() => setSelected(null)} />
        {native && <IconButton icon={Minus} label="Minimize" size="sm" onClick={() => bridge.minimize()} />}
      </header>

      <MessageList messages={messages} loading={loading} compact empty={<EmptyState compact />} />
      <Composer onSend={handleSend} disabled={busy} readClipboard={bridge.readClipboard} compact placeholder="Message" />
    </div>
  );
}
