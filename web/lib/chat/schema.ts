import { z } from "zod";

export const MAX_MESSAGE_CHARS = 4000;

// Firestore auto-IDs are 20 alphanumerics; allow a little slack.
const docId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const chatRequestSchema = z.object({
  conversationId: docId,
  userMessageId: docId,
  assistantMessageId: docId,
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export type Role = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: Date | null;
  messageCount: number;
}

const TITLE_MAX = 60;

// Auto-title from the first user message; no extra LLM call.
export function titleFrom(message: string): string {
  const firstLine = message.trim().split("\n")[0].replace(/\s+/g, " ");
  return firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 1).trimEnd()}…` : firstLine;
}
