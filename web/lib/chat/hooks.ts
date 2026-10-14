"use client";

import type { User } from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { collection, limit, onSnapshot, orderBy, query, type Timestamp } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase/client";
import { ChatRequestError, newConversationId, newMessageId, streamChat } from "@/lib/chat/client";
import type { ChatMessage, Conversation } from "@/lib/chat/schema";

export type ListenerError = "permission-denied" | "unknown";

function toListenerError(err: unknown): ListenerError {
  return err instanceof FirebaseError && err.code === "permission-denied" ? "permission-denied" : "unknown";
}

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

function useMessages(uid: string, conversationId: string | null) {
  const [state, setState] = useState<{ id: string | null; messages: ChatMessage[] }>({
    id: null,
    messages: [],
  });

  useEffect(() => {
    if (!conversationId) return;
    const q = query(
      collection(db(), "users", uid, "conversations", conversationId, "messages"),
      orderBy("createdAt"),
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
          })),
        }),
      (err) => console.error("Message listener failed", err),
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
    if (err.status === 429) return err.message;
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

  /** Sends a message; returns the conversation ID (new if none was active). */
  const send = useCallback(
    async (text: string): Promise<string> => {
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
        { id: userMessageId, conversationId: convId, role: "user", content: text, pending: "streaming" },
        { id: assistantMessageId, conversationId: convId, role: "assistant", content: "", pending: "streaming" },
      ]);

      void streamChat(user, { conversationId: convId, userMessageId, assistantMessageId, message: text }, (chunk) =>
        patch(assistantMessageId, (p) => ({ ...p, content: p.content + chunk })),
      )
        .then(() => {
          // Keep the streamed text visible until the snapshot copy replaces it.
          patch(userMessageId, (p) => ({ ...p, pending: undefined }));
          patch(assistantMessageId, (p) => ({ ...p, pending: undefined }));
        })
        .catch((err: unknown) => {
          patch(userMessageId, (p) => ({ ...p, pending: undefined }));
          patch(assistantMessageId, (p) => ({
            ...p,
            pending: "error",
            content: p.content || friendlyError(err),
          }));
        });

      return convId;
    },
    [conversationId, messages, user],
  );

  return { messages: displayed, loading, busy, send };
}
