import type { User } from "firebase/auth";
import { collection, doc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import type { ChatRequest } from "@/lib/chat/schema";

export class ChatRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Client-generated Firestore IDs, so pending UI items can be matched with the
// docs the server writes.
export function newConversationId(uid: string): string {
  return doc(collection(db(), "users", uid, "conversations")).id;
}

export function newMessageId(uid: string, conversationId: string): string {
  return doc(collection(db(), "users", uid, "conversations", conversationId, "messages")).id;
}

/** fetch with the user's ID token; throws ChatRequestError (with the server's message) on non-2xx. */
async function authedFetch(user: User, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await user.getIdToken();
  const res = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ChatRequestError(res.status, data?.error ?? `Request failed (${res.status})`);
  }
  return res;
}

export async function deleteConversation(user: User, conversationId: string): Promise<void> {
  await authedFetch(user, `/api/conversations/${encodeURIComponent(conversationId)}`, { method: "DELETE" });
}

export interface DeviceLink {
  deepLink: string;
  expiresAt: number;
}

/** Mints a one-hour link for the bubble app (bubble://link?token=…). */
export async function createDeviceLink(user: User): Promise<DeviceLink> {
  const res = await authedFetch(user, "/api/device-token", { method: "POST" });
  return (await res.json()) as DeviceLink;
}

/** Signs out every session of this account: bubble app and all browsers. */
export async function revokeAllSessions(user: User): Promise<void> {
  await authedFetch(user, "/api/revoke", { method: "POST" });
}

export async function streamChat(
  user: User,
  request: ChatRequest,
  onChunk: (chunk: string) => void,
): Promise<void> {
  const res = await authedFetch(user, "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.body) throw new ChatRequestError(res.status, "Empty response");

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(value);
  }
}
