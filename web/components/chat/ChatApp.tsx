"use client";

import type { User } from "firebase/auth";
import { useState } from "react";
import { Composer } from "@/components/chat/Composer";
import { MessageList } from "@/components/chat/MessageList";
import { Sidebar } from "@/components/chat/Sidebar";
import { useChat, useConversations } from "@/lib/chat/hooks";
import { signOut } from "@/lib/firebase/client";

export function ChatApp({ user }: { user: User }) {
  const { conversations, error } = useConversations(user.uid);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { messages, loading, busy, send } = useChat(user, activeId);

  if (error === "permission-denied") return <NotAllowed email={user.email} />;

  const title = conversations?.find((c) => c.id === activeId)?.title ?? "New chat";

  function select(id: string | null) {
    setActiveId(id);
    setDrawerOpen(false);
  }

  async function handleSend(text: string) {
    const id = await send(text);
    if (id !== activeId) setActiveId(id);
  }

  const sidebar = (
    <Sidebar
      conversations={conversations}
      activeId={activeId}
      email={user.email}
      onSelect={select}
      onNewChat={() => select(null)}
      onSignOut={() => signOut()}
    />
  );

  return (
    <div className="flex h-dvh pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <aside className="hidden w-72 shrink-0 border-r border-border md:block">{sidebar}</aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-20 md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[80%] max-w-xs pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-xl bg-muted">
            {sidebar}
          </aside>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open conversations"
            className="flex size-9 items-center justify-center rounded-lg hover:bg-muted md:hidden"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </button>
          <h1 className="min-w-0 flex-1 truncate px-2 text-sm font-medium">{title}</h1>
          <button
            type="button"
            onClick={() => select(null)}
            aria-label="New chat"
            className="flex size-9 items-center justify-center rounded-lg hover:bg-muted"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <MessageList
          messages={messages}
          loading={loading}
          empty={<p className="mt-24 text-center text-sm opacity-50">Ask me anything.</p>}
        />
        <Composer onSend={handleSend} disabled={busy} />
      </main>
    </div>
  );
}

function NotAllowed({ email }: { email: string | null }) {
  return (
    <main className="safe-area flex h-dvh items-center justify-center p-6 text-center">
      <div className="max-w-sm space-y-3">
        <h1 className="text-lg font-semibold">Not on the guest list</h1>
        <p className="text-sm opacity-70">
          {email ?? "This account"} isn&apos;t allowed to use this chat. Ask the owner to add you.
        </p>
        <button type="button" onClick={() => signOut()} className="text-sm underline">
          Use a different account
        </button>
      </div>
    </main>
  );
}
