"use client";

import type { User } from "firebase/auth";
import { Menu, PanelLeft, ShieldAlert, SquarePen } from "lucide-react";
import { useRef, useState } from "react";
import { Composer, type ComposerHandle } from "@/components/chat/Composer";
import { EmptyState } from "@/components/chat/EmptyState";
import { MessageList } from "@/components/chat/MessageList";
import { Sidebar } from "@/components/chat/Sidebar";
import { IconButton, Notice, SecondaryButton } from "@/components/ui";
import { deleteConversation } from "@/lib/chat/client";
import { useChat, useConversations } from "@/lib/chat/hooks";
import { signOut } from "@/lib/firebase/client";

export function ChatApp({ user }: { user: User }) {
  const { conversations, error } = useConversations(user.uid);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true); // desktop only
  const { messages, loading, busy, send } = useChat(user, activeId);
  const composer = useRef<ComposerHandle>(null);

  if (error === "permission-denied") {
    return (
      <Notice
        icon={ShieldAlert}
        tone="danger"
        title="You're not on the guest list"
        action={<SecondaryButton onClick={() => signOut()}>Use a different account</SecondaryButton>}
      >
        {user.email ?? "This account"} isn&apos;t allowed to use this chat. Ask the owner to add you.
      </Notice>
    );
  }

  const title = activeId ? (conversations?.find((c) => c.id === activeId)?.title ?? "") : "";

  function select(id: string | null) {
    setActiveId(id);
    setDrawerOpen(false);
  }

  async function handleSend(text: string) {
    const id = await send(text);
    if (id !== activeId) setActiveId(id);
  }

  function handleDelete(id: string) {
    if (id === activeId) setActiveId(null);
    // The snapshot listener removes it from the list once deleted.
    deleteConversation(user, id).catch((err) => console.error("Delete failed", err));
  }

  const sidebarProps = {
    conversations,
    activeId,
    user,
    onSelect: select,
    onDelete: handleDelete,
    onNewChat: () => select(null),
    onSignOut: () => signOut(),
  };

  return (
    <div className="flex h-dvh pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      {sidebarOpen && (
        <aside className="hidden w-[260px] shrink-0 pt-[env(safe-area-inset-top)] md:block">
          <Sidebar {...sidebarProps} onCollapse={() => setSidebarOpen(false)} />
        </aside>
      )}

      {drawerOpen && (
        <div className="fixed inset-0 z-30 md:hidden" role="dialog" aria-modal="true" aria-label="Conversations">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/40 animate-fade-in"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[85%] max-w-[300px] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-2xl bg-sidebar animate-slide-in">
            <Sidebar {...sidebarProps} onClose={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col pt-[env(safe-area-inset-top)]">
        <header className="flex h-14 shrink-0 items-center gap-1 px-2">
          <IconButton icon={Menu} label="Open conversations" onClick={() => setDrawerOpen(true)} className="md:hidden" />
          {!sidebarOpen && (
            <>
              <IconButton
                icon={PanelLeft}
                label="Open sidebar"
                onClick={() => setSidebarOpen(true)}
                className="hidden md:inline-flex"
              />
              <IconButton icon={SquarePen} label="New chat" onClick={() => select(null)} className="hidden md:inline-flex" />
            </>
          )}
          <h1 className="min-w-0 flex-1 truncate px-2 text-[15px] font-medium">{title || "Bubble"}</h1>
          <IconButton icon={SquarePen} label="New chat" onClick={() => select(null)} className="md:hidden" />
        </header>

        <MessageList
          messages={messages}
          loading={loading}
          empty={<EmptyState name={user.displayName} onStart={(starter) => composer.current?.setDraft(starter)} />}
        />
        <Composer ref={composer} onSend={handleSend} disabled={busy} />
      </main>
    </div>
  );
}
