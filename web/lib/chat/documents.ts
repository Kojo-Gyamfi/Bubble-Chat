import "server-only";

import { HttpError } from "@/lib/auth";
import { type ChatFile, FILE_MEDIA_TYPES, MAX_FILE_BYTES } from "@/lib/chat/schema";

/** Text kept per document (~15k tokens): sent with the message and saved for follow-up questions. */
export const MAX_FILE_TEXT_CHARS = 60_000;

const TRUNCATED_NOTE = "\n\n[…the rest of the document was cut off because it's too long]";
const UNREADABLE = "Couldn't read that file. Try a PDF, a Word (.docx) document or a text file.";

export interface ReadDocument {
  name: string;
  mediaType: ChatFile["mediaType"];
  size: number;
  /** Extracted text (may be empty for a scanned PDF). */
  text: string;
  /** PDFs also go to the model as the original file, which it reads better (layout, scans). */
  pdf?: string;
}

/** Collapses the whitespace extraction leaves behind, then caps the length. */
function tidy(text: string): string {
  const clean = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return clean.length > MAX_FILE_TEXT_CHARS ? clean.slice(0, MAX_FILE_TEXT_CHARS) + TRUNCATED_NOTE : clean;
}

/** Text of an attached PDF / Word / text file. Throws HttpError(400/413) for files we can't use. */
export async function readDocument(file: ChatFile): Promise<ReadDocument> {
  const bytes = Buffer.from(file.data, "base64");
  if (bytes.length > MAX_FILE_BYTES) throw new HttpError(413, "That file is too big. The limit is 3 MB.");
  if (bytes.length === 0) throw new HttpError(400, "That file is empty.");

  const base = { name: file.name, mediaType: file.mediaType, size: bytes.length };
  try {
    switch (file.mediaType) {
      case FILE_MEDIA_TYPES.text: {
        const text = new TextDecoder("utf-8").decode(bytes);
        // Lots of NUL / replacement characters: it's a binary file with a text-ish name.
        const junk = (text.match(/[\u0000�]/g) ?? []).length;
        if (junk > text.length * 0.05) throw new HttpError(400, UNREADABLE);
        return { ...base, text: tidy(text) };
      }
      case FILE_MEDIA_TYPES.docx: {
        const mammoth = await import("mammoth");
        const { value } = await mammoth.extractRawText({ buffer: bytes });
        return { ...base, text: tidy(value) };
      }
      case FILE_MEDIA_TYPES.pdf: {
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(new Uint8Array(bytes));
        const { text } = await extractText(pdf, { mergePages: true });
        return { ...base, text: tidy(text), pdf: file.data };
      }
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.warn(`Could not read ${file.mediaType} attachment`, err);
    throw new HttpError(400, UNREADABLE);
  }
}

/** How a document appears to the model as text (current message without native PDF support, or history). */
export function documentAsText(name: string, text: string): string {
  return `[Attached file: ${name}]\n${text || "(no readable text: it may be a scanned document)"}`;
}
