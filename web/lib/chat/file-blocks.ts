/**
 * Files the AI creates (Word, PDF, Excel, PowerPoint) live in the reply as a
 * block:
 *
 *   <bubble-file format="docx" name="Trip plan" href="https://…">
 *   …the content, in Markdown…
 *   </bubble-file>
 *
 * The model writes the block without `href`; the server builds the file, saves
 * it and adds `href` before the block reaches the client (lib/files/stream.ts).
 * The client shows a download card for it, and the content stays in the chat
 * history, so "now make it a PDF" works.
 */

export const FILE_FORMATS = ["docx", "pdf", "xlsx", "pptx"] as const;
export type FileFormat = (typeof FILE_FORMATS)[number];

export const FILE_TAG = "bubble-file";
export const FILE_OPEN = `<${FILE_TAG}`;
export const FILE_CLOSE = `</${FILE_TAG}>`;

export const FORMAT_INFO: Record<FileFormat, { label: string; extension: string; mimeType: string }> = {
  docx: {
    label: "Word document",
    extension: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  pdf: { label: "PDF", extension: "pdf", mimeType: "application/pdf" },
  xlsx: {
    label: "Excel spreadsheet",
    extension: "xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  pptx: {
    label: "PowerPoint presentation",
    extension: "pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
};

const FORMAT_ALIASES: Record<string, FileFormat> = {
  docx: "docx",
  doc: "docx",
  word: "docx",
  pdf: "pdf",
  xlsx: "xlsx",
  xls: "xlsx",
  excel: "xlsx",
  spreadsheet: "xlsx",
  csv: "xlsx",
  pptx: "pptx",
  ppt: "pptx",
  powerpoint: "pptx",
  slides: "pptx",
  presentation: "pptx",
};

/** "Word", "docx", ".DOCX" → "docx"; null if it isn't a format we make. */
export function toFileFormat(value: string | undefined): FileFormat | null {
  if (!value) return null;
  return FORMAT_ALIASES[value.trim().toLowerCase().replace(/^\./, "")] ?? null;
}

/** `format="docx" name='Plan'` → { format: "docx", name: "Plan" }. */
export function parseFileAttributes(openTag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of openTag.matchAll(/([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? "";
  }
  return attrs;
}

/**
 * The file's format and a clean name (no extension, no characters that break
 * file names). A name like "Budget.xlsx" also tells the format.
 */
export function fileSpec(attrs: Record<string, string>): { format: FileFormat; name: string } {
  const rawName = (attrs.name ?? "").trim();
  const extension = /\.([a-z]{3,4})$/i.exec(rawName)?.[1];
  const format = toFileFormat(attrs.format) ?? toFileFormat(extension) ?? "docx";
  const name =
    rawName
      .replace(/\.(docx?|pdf|xlsx?|csv|pptx?)$/i, "")
      .replace(/[\\/:*?"<>|\u0000-\u001F]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Document";
  return { format, name };
}

export type ReplyPart =
  | { type: "text"; text: string }
  | { type: "file"; format: FileFormat; name: string; href?: string; content: string; complete: boolean };

const BLOCK = /<bubble-file\b([^>]*)>([\s\S]*?)(<\/bubble-file>|$)/g;

/** Splits a reply into text and file blocks (an unfinished block counts as a file, not complete). */
export function splitFileBlocks(content: string): ReplyPart[] {
  const parts: ReplyPart[] = [];
  let last = 0;
  for (const match of content.matchAll(BLOCK)) {
    if (match.index > last) parts.push({ type: "text", text: content.slice(last, match.index) });
    const attrs = parseFileAttributes(match[1]);
    const { format, name } = fileSpec(attrs);
    parts.push({
      type: "file",
      format,
      name,
      href: attrs.href || undefined,
      content: match[2].trim(),
      complete: match[3] === FILE_CLOSE,
    });
    last = match.index + match[0].length;
  }
  if (last < content.length) parts.push({ type: "text", text: content.slice(last) });
  return parts;
}

/** The reply with each file block replaced (for copying, reading aloud, etc.). */
export function replaceFileBlocks(
  content: string,
  replacement: (file: Extract<ReplyPart, { type: "file" }>) => string,
): string {
  return splitFileBlocks(content)
    .map((part) => (part.type === "text" ? part.text : replacement(part)))
    .join("");
}

export function fileNameOf(file: { name: string; format: FileFormat }): string {
  return `${file.name}.${FORMAT_INFO[file.format].extension}`;
}
