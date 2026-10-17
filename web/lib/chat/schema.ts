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

/** Documents: 3 MB keeps the request (base64) under Vercel's 4.5 MB body limit. */
export const MAX_FILE_BYTES = 3 * 1024 * 1024;

export const FILE_MEDIA_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  /** Every text-like file (txt, md, csv, json, code…) is sent as text/plain; the name keeps its extension. */
  text: "text/plain",
} as const;

export const fileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[^\\/\p{Cc}]+$/u),
  mediaType: z.enum([FILE_MEDIA_TYPES.pdf, FILE_MEDIA_TYPES.docx, FILE_MEDIA_TYPES.text]),
  data: z
    .string()
    .max(Math.ceil(MAX_FILE_BYTES / 3) * 4)
    .regex(base64),
});

export type ChatFile = z.infer<typeof fileSchema>;

/** What the chat shows for an attached document (the file itself isn't kept). */
export interface FileInfo {
  name: string;
  mediaType: string;
  size: number;
}

export const chatRequestSchema = z
  .object({
    conversationId: docId,
    userMessageId: docId,
    assistantMessageId: docId,
    message: z.string().trim().max(MAX_MESSAGE_CHARS).default(""),
    image: imageSchema.optional(),
    file: fileSchema.optional(),
  })
  // A photo or file on its own is fine; an empty message without one isn't.
  .refine((r) => r.message.length > 0 || r.image || r.file, { message: "Message is empty" })
  .refine((r) => !(r.image && r.file), { message: "One attachment per message" });

export type ChatRequest = z.input<typeof chatRequestSchema>;

export type Role = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  /** User messages with a photo: its thumbnail as a data URL. */
  image?: string;
  /** User messages with a document: its name/type/size. */
  file?: FileInfo;
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
