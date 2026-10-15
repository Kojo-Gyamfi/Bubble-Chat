"use client";

import type { User } from "firebase/auth";
import { LogOut, PanelLeft, Smartphone, SquarePen, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconButton, Logo } from "@/components/ui";
import { groupByDate } from "@/lib/chat/group";
import type { Conversation } from "@/lib/chat/schema";

export function Sidebar({
  conversations,
  activeId,
  user,
  onSelect,
  onDelete,
  onNewChat,
  onSignOut,
  onClose,
  onCollapse,
}: {
  conversations: Conversation[] | null;
  activeId: string | null;
  user: User;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
  onSignOut: () => void;
  /** Mobile drawer: close button. */
  onClose?: () => void;
  /** Desktop: collapse the sidebar. */
  onCollapse?: () => void;
}) {
  // Two-tap delete (no confirm(): JS dialogs crash in the bubble WebView).
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const groups = useMemo(() => groupByDate(conversations ?? []), [conversations]);

  return (
    <nav className="flex h-full flex-col bg-sidebar" aria-label="Conversations">
      <div className="flex h-14 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-2 px-1">
          <Logo className="size-7" />
          <span className="text-[15px] font-semibold tracking-tight">Bubble</span>
        </div>
        {onClose && <IconButton icon={X} label="Close menu" onClick={onClose} />}
        {onCollapse && <IconButton icon={PanelLeft} label="Close sidebar" onClick={onCollapse} />}
      </div>

      <div className="space-y-0.5 px-2">
        <SidebarAction icon={SquarePen} label="New chat" onClick={onNewChat} />
        <Link
          href="/link"
          className="flex h-10 items-center gap-3 rounded-lg px-2.5 text-sm transition-colors hover:bg-surface-strong/70"
        >
          <Smartphone className="size-[18px] text-muted-foreground" aria-hidden="true" />
          Link bubble app
        </Link>
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {conversations === null && (
          <div className="space-y-2 px-2.5 pt-1" aria-label="Loading conversations">
            {[70, 55, 80, 45].map((w) => (
              <div key={w} className="h-4 animate-pulse rounded bg-surface-strong" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}
        {conversations?.length === 0 && (
          <p className="px-2.5 text-sm text-muted-foreground">Your conversations will appear here.</p>
        )}
        {groups.map((group) => (
          <section key={group.label} className="mb-4">
            <h2 className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{group.label}</h2>
            <ul>
              {group.items.map((c) => (
                <li key={c.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmId(null);
                      onSelect(c.id);
                    }}
                    aria-current={c.id === activeId ? "page" : undefined}
                    className="w-full truncate rounded-lg py-2 pr-10 pl-2.5 text-left text-sm transition-colors hover:bg-surface-strong/70 aria-[current=page]:bg-surface-strong"
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
                      className="absolute inset-y-1 right-1 rounded-md bg-danger px-2.5 text-xs font-medium text-white"
                    >
                      Delete
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmId(c.id)}
                      aria-label={`Delete ${c.title}`}
                      title="Delete"
                      className={`absolute inset-y-1 right-1 flex w-8 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:text-danger md:group-hover:opacity-100 ${
                        c.id === activeId ? "" : "md:opacity-0"
                      }`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="border-t border-border p-2">
        <AccountMenu user={user} onSignOut={onSignOut} />
      </div>
    </nav>
  );
}

function SidebarAction({ icon: Icon, label, onClick }: { icon: typeof SquarePen; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-sm transition-colors hover:bg-surface-strong/70"
    >
      <Icon className="size-[18px] text-muted-foreground" aria-hidden="true" />
      {label}
    </button>
  );
}

export function Avatar({ user, className = "size-8" }: { user: User; className?: string }) {
  const [broken, setBroken] = useState(false);
  const initial = (user.displayName || user.email || "?").trim()[0]?.toUpperCase();
  if (user.photoURL && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote Google avatar, tiny
      <img
        src={user.photoURL}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={`${className} shrink-0 rounded-full object-cover`}
      />
    );
  }
  return (
    <span
      className={`${className} flex shrink-0 items-center justify-center rounded-full bg-brand text-sm font-medium text-white`}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

function AccountMenu({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      {open && (
        <div
          role="menu"
          className="absolute right-0 bottom-full left-0 mb-2 overflow-hidden rounded-2xl border border-border bg-background p-1.5 shadow-lg animate-fade-up"
        >
          <div className="truncate px-3 py-2 text-xs text-muted-foreground">{user.email}</div>
          <button
            type="button"
            role="menuitem"
            onClick={onSignOut}
            className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm hover:bg-surface"
          >
            <LogOut className="size-4 text-muted-foreground" aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-surface-strong/70"
      >
        <Avatar user={user} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{user.displayName || user.email}</span>
          {user.displayName && <span className="block truncate text-xs text-muted-foreground">{user.email}</span>}
        </span>
      </button>
    </div>
  );
}
