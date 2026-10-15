"use client";

import type { User } from "firebase/auth";
import { Menu, Minus, ShieldAlert, SquarePen } from "lucide-react";
import { useEffect, useState } from "react";
import { Composer } from "@/components/chat/Composer";
import { EmptyState } from "@/components/chat/EmptyState";
import { MessageList } from "@/components/chat/MessageList";
import { Sidebar } from "@/components/chat/Sidebar";
import { FullScreenSpinner } from "@/components/Spinner";
import { IconButton, Notice } from "@/components/ui";
import { bridge } from "@/lib/bridge";
import { deleteConversation, reportBubbleLinked } from "@/lib/chat/client";
import { useChat, useConversations } from "@/lib/chat/hooks";
import { useIsNative } from "@/lib/overlay-auth";

/**
 * Compact chat for the bubble's ~320×480 WebView panel: a 44 px bar, the
 * most recent conversation, a drawer with recent chats, and a composer with a
 * paste button. No <select>/alert/confirm (they crash in a Service-context WebView).
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
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Lets the PWA's "Link bubble app" page show this bubble as already linked.
  useEffect(() => {
    if (native) reportBubbleLinked(user).catch((err) => console.warn("Couldn't report bubble link", err));
  }, [native, user]);

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

  function select(id: string | null) {
    setSelected(id);
    setDrawerOpen(false);
  }

  function handleDelete(id: string) {
    if (id === activeId) setSelected(null);
    // The snapshot listener removes it from the list once deleted.
    deleteConversation(user, id).catch((err) => console.error("Delete failed", err));
  }

  return (
    <div className="relative flex h-dvh flex-col bg-background pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-1">
        <IconButton icon={Menu} label="Recent chats" size="sm" onClick={() => setDrawerOpen(true)} />
        <h1 className="min-w-0 flex-1 truncate px-1 text-sm font-medium">{title}</h1>
        <IconButton icon={SquarePen} label="New chat" size="sm" onClick={() => select(null)} />
        {native && <IconButton icon={Minus} label="Minimize" size="sm" onClick={() => bridge.minimize()} />}
      </header>

      {drawerOpen && (
        <div className="absolute inset-0 z-30" role="dialog" aria-modal="true" aria-label="Recent chats">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/40 animate-fade-in"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[85%] max-w-[300px] bg-sidebar shadow-2xl animate-slide-in">
            <Sidebar
              compact
              conversations={conversations}
              activeId={activeId}
              user={user}
              onSelect={select}
              onDelete={handleDelete}
              onNewChat={() => select(null)}
              onClose={() => setDrawerOpen(false)}
            />
          </aside>
        </div>
      )}

      <MessageList messages={messages} loading={loading} compact empty={<EmptyState compact />} />
      <Composer onSend={handleSend} disabled={busy} readClipboard={bridge.readClipboard} compact placeholder="Message" />
    </div>
  );
}
