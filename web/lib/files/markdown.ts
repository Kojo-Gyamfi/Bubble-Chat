import "server-only";

import type { PhrasingContent, Root, RootContent, Table } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/** Markdown (with tables, strikethrough, task lists) → syntax tree. */
export function parseMarkdown(markdown: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(markdown);
}

/** A run of text with one style, the common ground for every file format. */
export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: string;
}

type Style = Omit<Span, "text">;

/** Only real web/mail links become clickable in files. */
function safeLink(url: string): string | undefined {
  return /^(https?:|mailto:)/i.test(url) ? url : undefined;
}

/** Inline Markdown → styled spans. A line break is a "\n" inside a span. */
export function toSpans(nodes: PhrasingContent[], style: Style = {}): Span[] {
  const out: Span[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out.push({ ...style, text: node.value });
        break;
      case "strong":
        out.push(...toSpans(node.children, { ...style, bold: true }));
        break;
      case "emphasis":
        out.push(...toSpans(node.children, { ...style, italic: true }));
        break;
      case "delete":
        out.push(...toSpans(node.children, { ...style, strike: true }));
        break;
      case "inlineCode":
        out.push({ ...style, code: true, text: node.value });
        break;
      case "link":
        out.push(...toSpans(node.children, { ...style, link: safeLink(node.url) }));
        break;
      case "break":
        out.push({ ...style, text: "\n" });
        break;
      case "image":
        if (node.alt) out.push({ ...style, italic: true, text: `[${node.alt}]` });
        break;
      case "html":
        out.push({ ...style, text: node.value.replace(/<[^>]+>/g, "") });
        break;
      default:
        // footnote references, link references…: keep any text inside
        if ("children" in node) out.push(...toSpans(node.children as PhrasingContent[], style));
        else if ("value" in node) out.push({ ...style, text: String(node.value) });
    }
  }
  return out.filter((s) => s.text !== "");
}

/** Plain text of any node (for cells, titles, sheet names…). */
export function plainText(node: RootContent | Root | PhrasingContent): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if (node.type === "break") return "\n";
  if ("children" in node) return (node.children as RootContent[]).map(plainText).join("");
  return "";
}

/** A table as rows of cells, each cell as spans. The first row is the header. */
export function tableRows(table: Table): Span[][][] {
  return table.children.map((row) => row.children.map((cell) => toSpans(cell.children)));
}

export function spansText(spans: Span[]): string {
  return spans.map((s) => s.text).join("");
}
