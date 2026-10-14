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

export async function streamChat(
  user: User,
  request: ChatRequest,
  onChunk: (chunk: string) => void,
): Promise<void> {
  const token = await user.getIdToken();
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(request),
  });

  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ChatRequestError(res.status, data?.error ?? `Request failed (${res.status})`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(value);
  }
}
