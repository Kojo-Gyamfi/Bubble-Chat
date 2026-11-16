import "server-only";

import path from "node:path";
import type { List, RootContent } from "mdast";
import pdfmake from "pdfmake";
import type { Content, ContentText, TDocumentDefinitions } from "pdfmake/interfaces";
import { parseMarkdown, type Span, tableRows, toSpans } from "@/lib/files/markdown";

// DejaVu covers Latin incl. ɛ/ɔ (Twi), Greek, Cyrillic, symbols. Shipped via the
// dejavu-fonts-ttf package and included in the function bundle (next.config.ts).
const FONT_DIR = path.join(process.cwd(), "node_modules", "dejavu-fonts-ttf", "ttf");
const font = (file: string) => path.join(FONT_DIR, file);
const FONTS = {
  DejaVu: {
    normal: font("DejaVuSans.ttf"),
    bold: font("DejaVuSans-Bold.ttf"),
    italics: font("DejaVuSans-Oblique.ttf"),
    bolditalics: font("DejaVuSans-BoldOblique.ttf"),
  },
  DejaVuMono: {
    normal: font("DejaVuSansMono.ttf"),
    bold: font("DejaVuSansMono.ttf"),
    italics: font("DejaVuSansMono.ttf"),
    bolditalics: font("DejaVuSansMono.ttf"),
  },
};
const FONT_PATHS = new Set(Object.values(FONTS).flatMap((f) => Object.values(f)));

let ready = false;

/** Registers the fonts once. Content comes from the AI: only our font files may be read, and no URLs fetched. */
function setUpPdfmake() {
  if (ready) return;
  pdfmake.setFonts(FONTS);
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy((file) => FONT_PATHS.has(file));
  ready = true;
}

/** The fonts have no colour emoji: drop them rather than print empty boxes. */
function printable(text: string): string {
  return text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, "");
}

const LINK_COLOR = "#1a56db";

/** fontkit takes { feature: false } to switch a feature off; the types only describe the list form. */
const NO_LIGATURES = { liga: false, clig: false } as unknown as PDFKit.Mixins.OpenTypeFeatures[];

function inline(spans: Span[]): ContentText[] {
  return spans.map((s) => ({
    text: printable(s.text),
    bold: s.bold,
    italics: s.italic,
    font: s.code ? "DejaVuMono" : undefined,
    fontSize: s.code ? 9.5 : undefined,
    background: s.code ? "#f1f1f1" : undefined,
    link: s.link,
    color: s.link ? LINK_COLOR : undefined,
    decoration: s.strike ? "lineThrough" : s.link ? "underline" : undefined,
  }));
}

function blocks(nodes: RootContent[]): Content[] {
  return nodes.flatMap((node) => block(node));
}

function listItems(list: List): Content[] {
  return list.children.map((item) => {
    const checkbox = item.checked === true ? "☑ " : item.checked === false ? "☐ " : "";
    const parts = item.children.map((child, i): Content => {
      if (child.type === "paragraph") {
        const text = inline(toSpans(child.children));
        return { text: i === 0 && checkbox ? [{ text: checkbox }, ...text] : text, margin: [0, 0, 0, 3] };
      }
      if (child.type === "list") return listContent(child);
      return { stack: blocks([child]) };
    });
    return parts.length === 1 ? parts[0] : { stack: parts };
  });
}

function listContent(list: List): Content {
  const items = listItems(list);
  return list.ordered ? { ol: items, start: list.start ?? 1, margin: [0, 0, 0, 8] } : { ul: items, margin: [0, 0, 0, 8] };
}

function block(node: RootContent): Content[] {
  switch (node.type) {
    case "heading":
      return [{ text: inline(toSpans(node.children)), style: `h${node.depth}` }];
    case "paragraph":
      return [{ text: inline(toSpans(node.children)), margin: [0, 0, 0, 8] }];
    case "list":
      return [listContent(node)];
    case "code":
      return [
        {
          table: {
            widths: ["*"],
            body: [[{ text: printable(node.value), font: "DejaVuMono", fontSize: 8.5, preserveLeadingSpaces: true }]],
          },
          layout: { fillColor: () => "#f3f3f3", hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6 },
          margin: [0, 0, 0, 10],
        },
      ];
    case "blockquote":
      return [{ stack: blocks(node.children), italics: true, color: "#555555", margin: [14, 0, 0, 8] }];
    case "table": {
      const rows = tableRows(node);
      const columns = Math.max(1, ...rows.map((r) => r.length));
      return [
        {
          table: {
            headerRows: 1,
            widths: Array.from({ length: columns }, () => "*"),
            body: rows.map((cells, r) =>
              Array.from({ length: columns }, (_, c) => ({
                text: inline(cells[c] ?? []),
                bold: r === 0,
                fillColor: r === 0 ? "#edeff3" : undefined,
                alignment: node.align?.[c] === "right" ? "right" : node.align?.[c] === "center" ? "center" : "left",
              })),
            ),
          },
          layout: "lightHorizontalLines",
          fontSize: 9.5,
          margin: [0, 2, 0, 12],
        },
      ];
    }
    case "thematicBreak":
      return [{ canvas: [{ type: "line", x1: 0, y1: 4, x2: 483, y2: 4, lineWidth: 0.6, lineColor: "#bbbbbb" }], margin: [0, 4, 0, 12] }];
    case "html":
      return [{ text: printable(node.value.replace(/<[^>]+>/g, "")), margin: [0, 0, 0, 8] }];
    default:
      return [];
  }
}

/** Markdown → PDF (A4). */
export async function markdownToPdf(title: string, markdown: string): Promise<Buffer> {
  setUpPdfmake();
  const content = blocks(parseMarkdown(markdown).children);
  const doc: TDocumentDefinitions = {
    info: { title, creator: "Bubble" },
    pageSize: "A4",
    pageMargins: [56, 56, 56, 56],
    content: content.length ? content : [{ text: title, style: "h1" }],
    // No "fi"/"fl" ligatures: they'd make copied text read "fve" instead of "five".
    defaultStyle: { font: "DejaVu", fontSize: 10.5, lineHeight: 1.25, fontFeatures: NO_LIGATURES },
    styles: {
      h1: { fontSize: 20, bold: true, margin: [0, 0, 0, 10] },
      h2: { fontSize: 15, bold: true, margin: [0, 10, 0, 6] },
      h3: { fontSize: 12.5, bold: true, margin: [0, 8, 0, 4] },
      h4: { fontSize: 11, bold: true, margin: [0, 6, 0, 4] },
      h5: { fontSize: 10.5, bold: true, italics: true, margin: [0, 6, 0, 4] },
      h6: { fontSize: 10.5, italics: true, margin: [0, 6, 0, 4] },
    },
    footer: (page, pages) => ({ text: `${page} / ${pages}`, alignment: "center", fontSize: 8, color: "#888888", margin: [0, 20, 0, 0] }),
  };
  return Buffer.from(await pdfmake.createPdf(doc).getBuffer());
}
