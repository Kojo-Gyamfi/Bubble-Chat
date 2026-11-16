import { replaceFileBlocks } from "@/lib/chat/file-blocks";

/**
 * A message's Markdown as readable plain text, for selecting and copying parts
 * of it: formatting marks go, but everything you can read stays (code, list
 * numbers, link addresses, table cells, a file's content).
 * Line-start patterns use [ \t], not \s, so they never swallow line breaks.
 */
export function messagePlainText(markdown: string): string {
  return (
    replaceFileBlocks(markdown, (file) => `\n${file.content}\n`)
      // Code blocks: keep the code, drop the fences.
      .replace(/```[^\n]*\n([\s\S]*?)(?:```|$)/g, (_, code: string) => code.replace(/\n$/, ""))
      .replace(/`([^`\n]+)`/g, "$1")
      // Images → their description; links → "text (address)" unless the text is the address.
      .replace(/!\[([^\]]*)\]\(<?[^)\s>]*>?\)/g, "$1")
      .replace(/\[([^\]]+)\]\(<?([^)\s>]+)>?\)/g, (_, text: string, url: string) => (text === url ? url : `${text} (${url})`))
      // Headings, quotes, bullets.
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
      .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
      .replace(/^([ \t]*)[-*+][ \t]+\[( |x|X)\][ \t]+/gm, (_, indent: string, mark: string) => `${indent}${mark.trim() ? "☑" : "☐"} `)
      .replace(/^([ \t]*)[-*+][ \t]+/gm, "$1• ")
      // Tables: drop the |---| row, separate cells with " | ".
      .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*(\n|$)/gm, "")
      .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, cells: string) => cells.split("|").map((c) => c.trim()).join("  |  "))
      // Emphasis marks.
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(^|[^\w*])\*(?![ \t])([^*\n]+?)\*(?!\w)/g, "$1$2")
      .replace(/(^|[^\w_])_(?![ \t])([^_\n]+?)_(?!\w)/g, "$1$2")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/^[ \t]*([*-][ \t]*){3,}$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
