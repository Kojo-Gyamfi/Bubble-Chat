"use client";

import { useState } from "react";
import type { Conversation } from "@/lib/chat/schema";

export function Sidebar({
  conversations,
  activeId,
  email,
  onSelect,
  onDelete,
  onNewChat,
  onSignOut,
}: {
  conversations: Conversation[] | null;
  activeId: string | null;
  email: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
  onSignOut: () => void;
}) {
  // Two-tap delete (no confirm(): JS dialogs crash in the bubble WebView).
  const [confirmId, setConfirmId] = useState<string | null>(null);

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
          <li key={c.id} className="group relative">
            <button
              type="button"
              onClick={() => {
                setConfirmId(null);
                onSelect(c.id);
              }}
              aria-current={c.id === activeId ? "page" : undefined}
              className="w-full truncate rounded-lg py-2 pr-10 pl-3 text-left text-sm hover:bg-background aria-[current=page]:bg-background aria-[current=page]:font-medium"
            >
              {c.title}
            </button>
            {confirmId === c.id ? (
              <button
                type="button"
                onClick={() => {
                  setConfirmId(null);
                  onDelete(c.id);
                }}
                onBlur={() => setConfirmId(null)}
                autoFocus
                className="absolute inset-y-1 right-1 rounded-md bg-red-600 px-2 text-xs font-medium text-white"
              >
                Delete?
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmId(c.id)}
                aria-label={`Delete ${c.title}`}
                className={`absolute inset-y-1 right-1 flex w-8 items-center justify-center rounded-md opacity-50 hover:opacity-100 md:group-hover:opacity-50 ${
                  c.id === activeId ? "" : "md:opacity-0"
                }`}
              >
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
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
