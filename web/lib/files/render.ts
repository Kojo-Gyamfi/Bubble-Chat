import "server-only";

import { type FileFormat, FORMAT_INFO } from "@/lib/chat/file-blocks";

type Renderer = (title: string, markdown: string) => Promise<Buffer>;

/**
 * Each builder is loaded only when a file of that type is asked for. Besides
 * keeping ordinary chat requests light, a builder that fails to load can then
 * only fail its own file (the reply falls back to text), never /api/chat as a
 * whole: a broken import at the top of the route once made every message fail.
 */
const RENDERERS: Record<FileFormat, () => Promise<Renderer>> = {
  docx: async () => (await import("@/lib/files/docx")).markdownToDocx,
  pdf: async () => (await import("@/lib/files/pdf")).markdownToPdf,
  xlsx: async () => (await import("@/lib/files/xlsx")).markdownToXlsx,
  pptx: async () => (await import("@/lib/files/pptx")).markdownToPptx,
};

/** Builds the file from the AI's Markdown. */
export async function renderFile(format: FileFormat, name: string, markdown: string): Promise<{ data: Buffer; mimeType: string }> {
  const render = await RENDERERS[format]();
  const data = await render(name, markdown);
  return { data, mimeType: FORMAT_INFO[format].mimeType };
}
