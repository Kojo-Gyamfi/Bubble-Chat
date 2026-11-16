"use client";

import { Check, Copy, MessageSquareQuote, SquareDashedText } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DisplayMessage } from "@/lib/chat/hooks";
import { messagePlainText } from "@/lib/chat/plain-text";
import { bridge } from "@/lib/bridge";

interface Selected {
  text: string;
  messageId: string;
  /** Where the selection is on screen. */
  top: number;
  bottom: number;
  centerX: number;
}

const MENU_HEIGHT = 44;
const MENU_GAP = 10;

/** The current selection, if it's text inside a chat message (not the composer). */
function readSelection(): Selected | null {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = selection.toString().trim();
  if (!text) return null;
  const node = selection.anchorNode;
  const element = node instanceof Element ? node : node?.parentElement;
  const message = element?.closest<HTMLElement>("[data-message-id]");
  if (!message?.dataset.messageId) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  return { text, messageId: message.dataset.messageId, top: rect.top, bottom: rect.bottom, centerX: rect.left + rect.width / 2 };
}

/**
 * A small menu for text selected in a message: Copy, Ask (quote it into your
 * message) and, in the bubble app 0.6+, Select more (the whole message in a
 * screen where Android's selection fully works). The bubble's window can't
 * show Android's own Copy / Share menu, so there this is the only one; in the
 * web app it adds Ask, and sits below the selection, clear of the phone's own bar.
 */
export function SelectionMenu({
  messages,
  onAsk,
  canSelectMore,
  placement = "above",
}: {
  messages: DisplayMessage[];
  onAsk: (quote: string) => void;
  canSelectMore: boolean;
  /** Where to put the menu when there's room. */
  placement?: "above" | "below";
}) {
  const [selected, setSelected] = useState<Selected | null>(null);
  const [copied, setCopied] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  // Measured after it renders, so it can be kept fully on screen.
  const [width, setWidth] = useState(240);
  useLayoutEffect(() => {
    if (menu.current) setWidth(menu.current.offsetWidth);
  }, [selected, copied, canSelectMore]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setSelected(readSelection());
        setCopied(false);
      });
    };
    document.addEventListener("selectionchange", update);
    // The chat scrolls under the selection: move the menu with it.
    document.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", update);
      document.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, []);

  const clear = useCallback(() => {
    document.getSelection()?.removeAllRanges();
    setSelected(null);
  }, []);

  if (!selected) return null;

  // On the preferred side of the selection, or the other side when there's no room.
  const above = selected.top - MENU_HEIGHT - MENU_GAP;
  const below = selected.bottom + MENU_GAP;
  const fitsBelow = below + MENU_HEIGHT <= window.innerHeight - 8;
  const top =
    placement === "below"
      ? fitsBelow ? below : Math.max(8, above)
      : above >= 8 ? above : Math.min(below, window.innerHeight - MENU_HEIGHT - 8);
  const left = Math.max(8, Math.min(selected.centerX - width / 2, window.innerWidth - width - 8));

  async function copy() {
    if (!selected || !(await bridge.copyText(selected.text))) return;
    setCopied(true);
    setTimeout(clear, 700);
  }

  function ask() {
    if (!selected) return;
    onAsk(selected.text);
    clear();
  }

  function selectMore() {
    const message = selected && messages.find((m) => m.id === selected.messageId);
    if (!message) return;
    bridge.selectText(messagePlainText(message.content), message.role === "user" ? "Your message" : "Bubble's reply");
    clear();
  }

  return (
    <div
      ref={menu}
      role="toolbar"
      aria-label="Selected text"
      style={{ top, left }}
      // Keep the selection when a button is pressed.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      className="fixed z-50 flex items-center gap-0.5 rounded-full border border-border bg-background p-1 shadow-lg animate-fade-up"
    >
      <MenuButton onClick={copy} icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}>
        {copied ? "Copied" : "Copy"}
      </MenuButton>
      <MenuButton onClick={ask} icon={<MessageSquareQuote className="size-4" />}>
        Ask
      </MenuButton>
      {canSelectMore && (
        <MenuButton onClick={selectMore} icon={<SquareDashedText className="size-4" />}>
          Select more
        </MenuButton>
      )}
    </div>
  );
}

function MenuButton({ onClick, icon, children }: { onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface active:bg-surface-strong"
    >
      <span aria-hidden="true">{icon}</span>
      {children}
    </button>
  );
}
