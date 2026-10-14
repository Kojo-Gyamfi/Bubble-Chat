"use client";

import type { Conversation } from "@/lib/chat/schema";

export function Sidebar({
  conversations,
  activeId,
  email,
  onSelect,
  onNewChat,
  onSignOut,
}: {
  conversations: Conversation[] | null;
  activeId: string | null;
  email: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onSignOut: () => void;
}) {
  return (
    <nav className="flex h-full flex-col bg-muted" aria-label="Conversations">
      <div className="p-3">
        <button
          type="button"
          onClick={onNewChat}
          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-left text-sm font-medium hover:border-accent"
        >
          + New chat
        </button>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto px-2">
        {conversations === null && <li className="px-3 py-2 text-sm opacity-50">Loading…</li>}
        {conversations?.length === 0 && <li className="px-3 py-2 text-sm opacity-50">No conversations yet</li>}
        {conversations?.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              aria-current={c.id === activeId ? "page" : undefined}
              className="w-full truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-background aria-[current=page]:bg-background aria-[current=page]:font-medium"
            >
              {c.title}
            </button>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between gap-2 border-t border-border p-3 text-xs">
        <span className="truncate opacity-60">{email}</span>
        <button type="button" onClick={onSignOut} className="shrink-0 underline opacity-80 hover:opacity-100">
          Sign out
        </button>
      </div>
    </nav>
  );
}
