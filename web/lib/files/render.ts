import "server-only";

import { type FileFormat, FORMAT_INFO } from "@/lib/chat/file-blocks";
import { markdownToDocx } from "@/lib/files/docx";
import { markdownToPdf } from "@/lib/files/pdf";
import { markdownToPptx } from "@/lib/files/pptx";
import { markdownToXlsx } from "@/lib/files/xlsx";

const RENDERERS: Record<FileFormat, (title: string, markdown: string) => Promise<Buffer>> = {
  docx: markdownToDocx,
  pdf: markdownToPdf,
  xlsx: markdownToXlsx,
  pptx: markdownToPptx,
};

/** Builds the file from the AI's Markdown. */
export async function renderFile(format: FileFormat, name: string, markdown: string): Promise<{ data: Buffer; mimeType: string }> {
  const data = await RENDERERS[format](name, markdown);
  return { data, mimeType: FORMAT_INFO[format].mimeType };
}
