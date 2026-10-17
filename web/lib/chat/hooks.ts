"use client";

import type { User } from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { collection, doc, limit, limitToLast, onSnapshot, orderBy, query, type Timestamp } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/lib/firebase/client";
import { ChatRequestError, fetchMessagesLeft, newConversationId, newMessageId, streamChat } from "@/lib/chat/client";
import type { ChatImage, ChatMessage, Conversation } from "@/lib/chat/schema";

export type ListenerError = "permission-denied" | "unknown";

function toListenerError(err: unknown): ListenerError {
  return err instanceof FirebaseError && err.code === "permission-denied" ? "permission-denied" : "unknown";
}

/** Messages loaded per conversation (newest). */
const MAX_LOADED_MESSAGES = 100;

export function useConversations(uid: string) {
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<ListenerError | null>(null);

  useEffect(() => {
    const q = query(
      collection(db(), "users", uid, "conversations"),
      orderBy("updatedAt", "desc"),
      limit(50),
    );
    return onSnapshot(
      q,
      (snap) => {
        setError(null);
        setConversations(
          snap.docs.map((d) => ({
            id: d.id,
            title: (d.get("title") as string) || "Untitled",
            updatedAt: (d.get("updatedAt") as Timestamp | null)?.toDate() ?? null,
            messageCount: (d.get("messageCount") as number) ?? 0,
          })),
        );
      },
      (err) => setError(toListenerError(err)),
    );
  }, [uid]);

  return { conversations, error };
}

/**
 * When the bubble app was last opened signed in as this user (users/{uid}.bubbleSeenAt).
 * undefined = loading, null = not linked (or unlinked since).
 */
export function useBubbleSeenAt(uid: string): Date | null | undefined {
  const [seenAt, setSeenAt] = useState<Date | null | undefined>(undefined);

  useEffect(() => {
    return onSnapshot(
      doc(db(), "users", uid),
      (snap) => setSeenAt((snap.get("bubbleSeenAt") as Timestamp | undefined)?.toDate() ?? null),
      (err) => {
        console.error("Profile listener failed", err);
        setSeenAt(null); // fall back to offering a link
      },
    );
  }, [uid]);

  return seenAt;
}

function useMessages(uid: string, conversationId: string | null) {
  const [state, setState] = useState<{ id: string | null; messages: ChatMessage[] }>({
    id: null,
    messages: [],
  });

  useEffect(() => {
    if (!conversationId) return;
    // Latest messages only: every document a listener loads is a Firestore read
    // (free plan: 50k/day), and huge DOMs slow the chat down.
    const q = query(
      collection(db(), "users", uid, "conversations", conversationId, "messages"),
      orderBy("createdAt"),
      limitToLast(MAX_LOADED_MESSAGES),
    );
    return onSnapshot(
      q,
      (snap) =>
        setState({
          id: conversationId,
          messages: snap.docs.map((d) => ({
            id: d.id,
            role: d.get("role") as ChatMessage["role"],
            content: d.get("content") as string,
            image: (d.get("image") as string | undefined) || undefined,
          })),
        }),
      (err) => {
        console.error("Message listener failed", err);
        // Stop showing "loading" forever; keep whatever we had.
        setState((s) => (s.id === conversationId ? s : { id: conversationId, messages: [] }));
      },
    );
  }, [uid, conversationId]);

  // Ignore results that belong to the previously selected conversation.
  const current = state.id === conversationId;
  return { messages: current ? state.messages : [], loading: !!conversationId && !current };
}

export type PendingStatus = "streaming" | "error";

export interface DisplayMessage extends ChatMessage {
  pending?: PendingStatus;
}

interface PendingMessage extends DisplayMessage {
  conversationId: string;
}

export function friendlyError(err: unknown): string {
  if (err instanceof ChatRequestError) {
    if (err.status === 401) return "Your session expired. Sign in again.";
    if (err.status === 403) return "This account isn't allowed to use the chat.";
    // Offline / timeout (0), limit reached (429), AI unavailable (503): the message is meant for users.
    if (err.status === 0 || err.status === 429 || err.status === 503) return err.message;
  }
  return "Something went wrong. Please try again.";
}

/**
 * Messages for one conversation: Firestore snapshot plus locally pending
 * messages (keyed by client-generated IDs) that haven't arrived in the
 * snapshot yet. Once the server-written doc shows up, it replaces the pending one.
 */
export function useChat(user: User, conversationId: string | null) {
  const { messages, loading } = useMessages(user.uid, conversationId);
  const [pending, setPending] = useState<PendingMessage[]>([]);

  const displayed: DisplayMessage[] = useMemo(() => {
    const saved = new Set(messages.map((m) => m.id));
    const local = pending.filter((p) => p.conversationId === conversationId && !saved.has(p.id));
    return [...messages, ...local];
  }, [messages, pending, conversationId]);

  const busy = pending.some((p) => p.conversationId === conversationId && p.pending === "streaming");

  // Stop button: aborts the reply being streamed.
  const stopController = useRef<AbortController | null>(null);
  const stop = useCallback(() => stopController.current?.abort(), []);

  // Messages left today; shown when it gets low. null = unknown yet.
  const [messagesLeft, setMessagesLeft] = useState<number | null>(null);
  useEffect(() => {
    fetchMessagesLeft(user)
      .then(setMessagesLeft)
      .catch(() => {}); // only a hint
  }, [user]);

  /** Sends a message (and optional photo); returns the conversation ID (new if none was active). */
  const send = useCallback(
    async (text: string, image?: ChatImage): Promise<string> => {
      const convId = conversationId ?? newConversationId(user.uid);
      const userMessageId = newMessageId(user.uid, convId);
      const assistantMessageId = newMessageId(user.uid, convId);

      const patch = (id: string, fn: (p: PendingMessage) => PendingMessage) =>
        setPending((list) => list.map((p) => (p.id === id ? fn(p) : p)));

      const saved = new Set(messages.map((m) => m.id));
      setPending((list) => [
        // Prune items the snapshot has caught up with, and old errors (already seen).
        ...list.filter(
          (p) =>
            p.pending === "streaming" ||
            p.conversationId !== convId ||
            (!saved.has(p.id) && p.pending !== "error"),
        ),
        { id: userMessageId, conversationId: convId, role: "user", content: text, image: image?.thumbnail, pending: "streaming" },
        { id: assistantMessageId, conversationId: convId, role: "assistant", content: "", pending: "streaming" },
      ]);

      const controller = new AbortController();
      stopController.current = controller;
      let gotCount = false;
      const onMessagesLeft = (left: number) => {
        gotCount = true;
        setMessagesLeft(left);
      };

      void streamChat(
        user,
        { conversationId: convId, userMessageId, assistantMessageId, message: text, image },
        (chunk) => patch(assistantMessageId, (p) => ({ ...p, content: p.content + chunk })),
        { signal: controller.signal, onMessagesLeft },
      )
        .then(({ stopped }) => {
          // Keep the streamed text visible until the snapshot copy replaces it.
          patch(userMessageId, (p) => ({ ...p, pending: undefined }));
          patch(assistantMessageId, (p) => ({
            ...p,
            pending: undefined,
            // Same note the server saves, so nothing jumps when the saved copy arrives.
            content: stopped ? `${p.content.trimEnd()}

_(stopped)_`.trimStart() : p.content,
          }));
        })
        .catch((err: unknown) => {
          patch(userMessageId, (p) => ({ ...p, pending: undefined }));
          patch(assistantMessageId, (p) => ({
            ...p,
            pending: "error",
            content: p.content || friendlyError(err),
          }));
        })
        .finally(() => {
          if (stopController.current === controller) stopController.current = null;
          // Stopped (or failed) before the response headers: ask for the count instead.
          if (!gotCount) fetchMessagesLeft(user).then(setMessagesLeft, () => {});
        });

      return convId;
    },
    [conversationId, messages, user],
  );

  return { messages: displayed, loading, busy, send, stop, messagesLeft };
}
