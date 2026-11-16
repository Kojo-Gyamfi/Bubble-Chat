import "server-only";

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { List, RootContent } from "mdast";
import { parseMarkdown, type Span, tableRows, toSpans } from "@/lib/files/markdown";

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

const MONO = "Consolas";
const LIST_INDENT = 360; // twips per level

/** Styled spans → Word runs (links become hyperlinks, "\n" a line break). */
function runs(spans: Span[], extra: { bold?: boolean; italics?: boolean } = {}): (TextRun | ExternalHyperlink)[] {
  return spans.flatMap((span) =>
    span.text.split("\n").map((text, i) => {
      const run = new TextRun({
        text,
        break: i > 0 ? 1 : undefined,
        bold: span.bold || extra.bold,
        italics: span.italic || extra.italics,
        strike: span.strike,
        font: span.code ? MONO : undefined,
        style: span.link ? "Hyperlink" : undefined,
      });
      return span.link ? new ExternalHyperlink({ link: span.link, children: [run] }) : run;
    }),
  );
}

class DocxBuilder {
  /** Each numbered list restarts at 1: a new numbering instance per list. */
  private numberedLists = 0;

  blocks(nodes: RootContent[], quote = false): (Paragraph | Table)[] {
    return nodes.flatMap((node) => this.block(node, quote));
  }

  private block(node: RootContent, quote: boolean): (Paragraph | Table)[] {
    const indent = quote ? { left: 567 } : undefined;
    const border = quote ? { left: { style: BorderStyle.SINGLE, size: 12, color: "BBBBBB", space: 8 } } : undefined;
    switch (node.type) {
      case "heading":
        return [new Paragraph({ heading: HEADINGS[node.depth - 1], children: runs(toSpans(node.children)) })];
      case "paragraph":
        return [
          new Paragraph({
            children: runs(toSpans(node.children), { italics: quote }),
            spacing: { after: 140 },
            indent,
            border,
          }),
        ];
      case "list":
        return this.list(node, 0);
      case "code":
        return node.value.split("\n").map(
          (line, i, lines) =>
            new Paragraph({
              children: [new TextRun({ text: line || " ", font: MONO, size: 19 })],
              shading: { type: ShadingType.CLEAR, color: "auto", fill: "F3F3F3" },
              spacing: { after: i === lines.length - 1 ? 160 : 0 },
            }),
        );
      case "blockquote":
        return this.blocks(node.children, true);
      case "table":
        return [this.table(node), new Paragraph({ children: [], spacing: { after: 120 } })];
      case "thematicBreak":
        return [
          new Paragraph({
            children: [],
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "BBBBBB", space: 1 } },
            spacing: { after: 160 },
          }),
        ];
      case "html":
        return [new Paragraph({ children: [new TextRun(node.value.replace(/<[^>]+>/g, ""))] })];
      default:
        return [];
    }
  }

  private list(list: List, level: number): (Paragraph | Table)[] {
    const instance = list.ordered ? ++this.numberedLists : 0;
    const reference = list.ordered ? "numbers" : "bullets";
    return list.children.flatMap((item) =>
      item.children.flatMap((child, i): (Paragraph | Table)[] => {
        if (child.type === "list") return this.list(child, Math.min(level + 1, 4));
        if (child.type === "paragraph" && i === 0) {
          const checkbox = item.checked === true ? "☑ " : item.checked === false ? "☐ " : "";
          const spans = toSpans(child.children);
          return [
            new Paragraph({
              children: runs(checkbox ? [{ text: checkbox }, ...spans] : spans),
              numbering: { reference, level, instance: list.ordered ? instance : undefined },
              spacing: { after: 60 },
            }),
          ];
        }
        // Further content of the same item (paragraphs, code, tables): no bullet.
        return this.blocks([child]);
      }),
    );
  }

  private table(node: Extract<RootContent, { type: "table" }>): Table {
    const rows = tableRows(node);
    const columns = Math.max(1, ...rows.map((r) => r.length));
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rows.map(
        (cells, r) =>
          new TableRow({
            tableHeader: r === 0,
            children: Array.from({ length: columns }, (_, c) => {
              const align = node.align?.[c];
              return new TableCell({
                shading: r === 0 ? { type: ShadingType.CLEAR, color: "auto", fill: "EDEFF3" } : undefined,
                margins: { top: 60, bottom: 60, left: 100, right: 100 },
                children: [
                  new Paragraph({
                    alignment: align === "right" ? AlignmentType.RIGHT : align === "center" ? AlignmentType.CENTER : AlignmentType.LEFT,
                    children: runs(cells[c] ?? [], { bold: r === 0 }),
                  }),
                ],
              });
            }),
          }),
      ),
    });
  }
}

function listLevels(format: (typeof LevelFormat)[keyof typeof LevelFormat], text: (level: number) => string) {
  return Array.from({ length: 5 }, (_, level) => ({
    level,
    format,
    text: text(level),
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: LIST_INDENT * (level + 1) + 360, hanging: 360 } } },
  }));
}

/** Markdown → Word document. */
export async function markdownToDocx(title: string, markdown: string): Promise<Buffer> {
  const children = new DocxBuilder().blocks(parseMarkdown(markdown).children);
  const doc = new Document({
    title,
    creator: "Bubble",
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
    },
    numbering: {
      config: [
        { reference: "bullets", levels: listLevels(LevelFormat.BULLET, (l) => ["•", "◦", "▪", "•", "◦"][l]) },
        { reference: "numbers", levels: listLevels(LevelFormat.DECIMAL, (l) => `%${l + 1}.`) },
      ],
    },
    sections: [{ children: children.length ? children : [new Paragraph({ heading: HeadingLevel.TITLE, text: title })] }],
  });
  return Packer.toBuffer(doc);
}
