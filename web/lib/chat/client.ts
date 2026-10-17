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

/** Status 0 = never got an HTTP response (offline, timeout, connection dropped). */
const OFFLINE = "You're offline. Check your connection and try again.";
const UNREACHABLE = "Couldn't reach Bubble. Check your connection and try again.";
const TOO_SLOW = "The reply took too long. Please try again.";

/** No bytes for this long ⇒ give up (the server itself stops at 60 s). */
const STREAM_IDLE_TIMEOUT_MS = 60_000;

/** fetch with the user's ID token; throws ChatRequestError (with the server's message) on non-2xx. */
async function authedFetch(user: User, url: string, init: RequestInit = {}): Promise<Response> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new ChatRequestError(0, OFFLINE);
  const token = await user.getIdToken();
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    if (init.signal?.aborted) throw new ChatRequestError(0, TOO_SLOW);
    throw new ChatRequestError(0, err instanceof TypeError ? UNREACHABLE : String(err));
  }
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

/** Bubble app only: marks this account's bubble as linked (shown on /link). */
export async function reportBubbleLinked(user: User): Promise<void> {
  await authedFetch(user, "/api/device-linked", { method: "POST" });
}

/** Signs out every session of this account: bubble app and all browsers. */
export async function revokeAllSessions(user: User): Promise<void> {
  await authedFetch(user, "/api/revoke", { method: "POST" });
}

/** Messages the user has left today (for the "N left" hint). */
export async function fetchMessagesLeft(user: User): Promise<number> {
  const res = await authedFetch(user, "/api/usage");
  return ((await res.json()) as { remaining: number }).remaining;
}

export interface StreamChatOptions {
  /** Aborting it is the Stop button: the reply ends and what arrived is kept. */
  signal?: AbortSignal;
  onMessagesLeft?: (remaining: number) => void;
}

/** Streams a reply. Resolves with stopped=true if the user pressed Stop. */
export async function streamChat(
  user: User,
  request: ChatRequest,
  onChunk: (chunk: string) => void,
  { signal, onMessagesLeft }: StreamChatOptions = {},
): Promise<{ stopped: boolean }> {
  // Abort if nothing arrives for a while, so a stalled connection can't leave
  // the composer stuck in "busy" forever. Reset on every chunk.
  const controller = new AbortController();
  let idle = setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT_MS);
  const bump = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(), STREAM_IDLE_TIMEOUT_MS);
  };
  const userStopped = () => signal?.aborted === true;
  const onStop = () => controller.abort();
  signal?.addEventListener("abort", onStop, { once: true });

  try {
    const res = await authedFetch(user, "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const left = Number.parseInt(res.headers.get("X-Messages-Left") ?? "", 10);
    if (Number.isFinite(left)) onMessagesLeft?.(left);
    if (res.status === 204) return { stopped: true }; // stopped before the first word
    if (!res.body) throw new ChatRequestError(res.status, "Empty response");

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      bump();
      const { done, value } = await reader.read();
      if (done) break;
      onChunk(value);
    }
    return { stopped: false };
  } catch (err) {
    if (userStopped()) return { stopped: true };
    if (err instanceof ChatRequestError) {
      if (err.status === 429) onMessagesLeft?.(0);
      throw err;
    }
    // Reading the stream failed: aborted by the idle timer or the connection dropped.
    // The server saves what it generated; it shows up via Firestore.
    throw new ChatRequestError(0, controller.signal.aborted ? TOO_SLOW : UNREACHABLE);
  } finally {
    clearTimeout(idle);
    signal?.removeEventListener("abort", onStop);
  }
}
