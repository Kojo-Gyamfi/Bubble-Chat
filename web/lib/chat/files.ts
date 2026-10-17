"use client";

import { type ChatFile, type ChatImage, FILE_MEDIA_TYPES, type FileInfo, MAX_FILE_BYTES } from "@/lib/chat/schema";

/** Extensions read as plain text (the server decodes them as UTF-8). */
const TEXT_EXTENSIONS = new Set(
  (
    "txt md markdown csv tsv json jsonl xml yaml yml toml ini log html htm css scss " +
    "js jsx ts tsx mjs cjs py java kt kts c h cpp hpp cs go rs rb php swift dart sql sh bat ps1 r m tex"
  ).split(" "),
);

/** For <input accept> in browsers. */
export const FILE_ACCEPT = [".pdf", ".docx", ...[...TEXT_EXTENSIONS].map((e) => `.${e}`)].join(",");

export const UNSUPPORTED_FILE =
  "That type of file isn't supported yet. Try a PDF, a Word (.docx) document or a text file.";
export const FILE_TOO_BIG = "That file is too big. The limit is 3 MB.";

export interface PreparedFile {
  file: ChatFile;
  info: FileInfo;
}

/** What a message can carry besides text: one photo or one document. */
export interface Attachments {
  image?: ChatImage;
  file?: PreparedFile;
}

function mediaTypeFor(name: string, type: string): ChatFile["mediaType"] | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || type === FILE_MEDIA_TYPES.pdf) return FILE_MEDIA_TYPES.pdf;
  if (ext === "docx" || type === FILE_MEDIA_TYPES.docx) return FILE_MEDIA_TYPES.docx;
  if (TEXT_EXTENSIONS.has(ext) || type.startsWith("text/") || type === "application/json") return FILE_MEDIA_TYPES.text;
  return null;
}

function readAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error(UNSUPPORTED_FILE));
    reader.readAsDataURL(blob);
  });
}

/**
 * A picked document (browser File, or from the bubble app as a data URL) →
 * what /api/chat takes. Throws with a user-facing message if it can't be sent.
 */
export async function prepareFile(source: File | { name: string; mimeType: string; dataUrl: string }): Promise<PreparedFile> {
  const name = source.name.replace(/[\\/\p{Cc}]/gu, "_").slice(-200) || "file";
  const type = source instanceof File ? source.type : source.mimeType;
  const mediaType = mediaTypeFor(name, type);
  if (!mediaType) throw new Error(UNSUPPORTED_FILE);

  let data: string;
  let size: number;
  if (source instanceof File) {
    if (source.size > MAX_FILE_BYTES) throw new Error(FILE_TOO_BIG);
    if (source.size === 0) throw new Error("That file is empty.");
    size = source.size;
    data = await readAsBase64(source);
  } else {
    data = source.dataUrl.slice(source.dataUrl.indexOf(",") + 1);
    size = Math.floor((data.length * 3) / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
    if (size > MAX_FILE_BYTES) throw new Error(FILE_TOO_BIG);
  }
  return { file: { name, mediaType, data }, info: { name, mediaType, size } };
}

/** "2.4 MB", "820 KB". */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "PDF", "Word", or the extension, for the file chip. */
export function fileKind(info: FileInfo): string {
  if (info.mediaType === FILE_MEDIA_TYPES.pdf) return "PDF";
  if (info.mediaType === FILE_MEDIA_TYPES.docx) return "Word";
  return (info.name.split(".").pop() ?? "Text").toUpperCase().slice(0, 6);
}
