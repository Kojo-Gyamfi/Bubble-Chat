import { z } from "zod";

export const MAX_MESSAGE_CHARS = 4000;

// Firestore auto-IDs are 20 alphanumerics; allow a little slack.
const docId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** Base64 of the (client-resized) image sent to the model: ~1.5 MB decoded at most. */
export const MAX_IMAGE_BASE64_CHARS = 2_000_000;
/** The small preview saved in Firestore with the message (it's all the history keeps). */
export const MAX_THUMBNAIL_CHARS = 60_000;

const base64 = /^[A-Za-z0-9+/]+={0,2}$/;

export const imageSchema = z.object({
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  data: z.string().max(MAX_IMAGE_BASE64_CHARS).regex(base64),
  thumbnail: z
    .string()
    .max(MAX_THUMBNAIL_CHARS)
    .regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
});

export type ChatImage = z.infer<typeof imageSchema>;

export const chatRequestSchema = z
  .object({
    conversationId: docId,
    userMessageId: docId,
    assistantMessageId: docId,
    message: z.string().trim().max(MAX_MESSAGE_CHARS).default(""),
    image: imageSchema.optional(),
  })
  // A photo on its own is fine; an empty message without one isn't.
  .refine((r) => r.message.length > 0 || r.image, { message: "Message is empty" });

export type ChatRequest = z.input<typeof chatRequestSchema>;

export type Role = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  /** User messages with a photo: its thumbnail as a data URL. */
  image?: string;
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
  if (!firstLine) return "📷 Photo";
  return firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 1).trimEnd()}…` : firstLine;
}
