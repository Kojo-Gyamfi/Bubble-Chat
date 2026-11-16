import "server-only";

import type { List, RootContent, Table } from "mdast";
import PptxGenJS from "pptxgenjs";
import { parseMarkdown, plainText, type Span, spansText, tableRows, toSpans } from "@/lib/files/markdown";

type TextRun = PptxGenJS.TextProps;

interface Line {
  spans: Span[];
  bullet?: "bullet" | "number";
  level: number;
  heading?: boolean;
}

interface SlideSpec {
  title: string;
  lines: Line[];
  tables: Table[];
  notes: string[];
}

const DARK = "1F2937";
const ACCENT = "2563EB";
const BODY = "374151";
/** More lines than this on one slide gets split over "(cont.)" slides. */
const MAX_LINES = 8;

function listLines(list: List, level: number): Line[] {
  return list.children.flatMap((item) =>
    item.children.flatMap((child, i): Line[] => {
      if (child.type === "list") return listLines(child, level + 1);
      if (child.type === "paragraph") {
        return [{ spans: toSpans(child.children), bullet: i === 0 ? (list.ordered ? "number" : "bullet") : undefined, level }];
      }
      return [];
    }),
  );
}

/**
 * Markdown → slides: the first "# Title" (and the text under it) is the title
 * slide; every "## Heading" (or later "#") starts a slide. Lists become
 * bullets, tables become tables, and "> quotes" become speaker notes.
 */
function toSlides(title: string, nodes: RootContent[]): { cover: { title: string; subtitle: string }; slides: SlideSpec[] } {
  const cover = { title, subtitle: "" };
  const slides: SlideSpec[] = [];
  let current: SlideSpec | null = null;
  let onCover = true;
  for (const node of nodes) {
    if (node.type === "heading" && node.depth === 1 && onCover && !slides.length) {
      cover.title = plainText(node).trim() || title;
      continue;
    }
    if (node.type === "heading" && node.depth <= 2) {
      onCover = false;
      current = { title: plainText(node).trim(), lines: [], tables: [], notes: [] };
      slides.push(current);
      continue;
    }
    if (onCover && !current) {
      // Text before the first slide heading: the cover's subtitle.
      const text = plainText(node).trim();
      if (text) cover.subtitle = cover.subtitle ? `${cover.subtitle}\n${text}` : text;
      continue;
    }
    if (!current) continue;
    switch (node.type) {
      case "heading":
        current.lines.push({ spans: toSpans(node.children), level: 0, heading: true });
        break;
      case "paragraph":
        current.lines.push({ spans: toSpans(node.children), level: 0 });
        break;
      case "list":
        current.lines.push(...listLines(node, 0));
        break;
      case "table":
        current.tables.push(node);
        break;
      case "blockquote":
        current.notes.push(plainText(node).trim());
        break;
      case "code":
        current.lines.push({ spans: [{ text: node.value, code: true }], level: 0 });
        break;
    }
  }
  return { cover, slides };
}

function runs(line: Line, size: number): TextRun[] {
  const spans = line.spans.length ? line.spans : [{ text: " " }];
  return spans.map((s, i) => ({
    text: s.text,
    options: {
      bold: s.bold || line.heading,
      italic: s.italic,
      strike: s.strike ? "sngStrike" : undefined,
      fontFace: s.code ? "Consolas" : undefined,
      hyperlink: s.link ? { url: s.link } : undefined,
      color: s.link ? ACCENT : undefined,
      fontSize: line.heading ? size + 2 : size,
      bullet: line.bullet === "number" ? { type: "number" } : line.bullet === "bullet" ? true : undefined,
      indentLevel: line.level,
      paraSpaceAfter: 6,
      breakLine: i === spans.length - 1,
    },
  }));
}

function addTitle(pptx: PptxGenJS, slide: PptxGenJS.Slide, text: string) {
  slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 0.45, w: 0.08, h: 0.7, fill: { color: ACCENT }, line: { color: ACCENT } });
  slide.addText(text, { x: 0.75, y: 0.35, w: 11.9, h: 0.9, fontSize: 28, bold: true, color: DARK, valign: "middle", fit: "shrink" });
}

/** Markdown → PowerPoint (16:9). */
export async function markdownToPptx(title: string, markdown: string): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 × 7.5 in
  pptx.title = title;
  pptx.author = "Bubble";
  const { cover, slides } = toSlides(title, parseMarkdown(markdown).children);

  const coverSlide = pptx.addSlide();
  coverSlide.background = { color: DARK };
  coverSlide.addText(cover.title, { x: 0.8, y: 2.3, w: 11.7, h: 1.6, fontSize: 40, bold: true, color: "FFFFFF", fit: "shrink" });
  if (cover.subtitle) {
    coverSlide.addText(cover.subtitle, { x: 0.8, y: 4.0, w: 11.7, h: 1.4, fontSize: 20, color: "CBD5E1", valign: "top", fit: "shrink" });
  }

  for (const spec of slides) {
    const pages = spec.lines.length ? Array.from({ length: Math.ceil(spec.lines.length / MAX_LINES) }, (_, i) => spec.lines.slice(i * MAX_LINES, (i + 1) * MAX_LINES)) : [[]];
    pages.forEach((lines, page) => {
      const slide = pptx.addSlide();
      addTitle(pptx, slide, page ? `${spec.title} (cont.)` : spec.title);
      let y = 1.5;
      if (lines.length) {
        const size = lines.length > 6 ? 18 : 20;
        const height = spec.tables.length && page === pages.length - 1 ? 2.6 : 5.5;
        slide.addText(lines.flatMap((line) => runs(line, size)), { x: 0.75, y, w: 11.9, h: height, color: BODY, valign: "top", fit: "shrink" });
        y += height + 0.15;
      }
      if (page === pages.length - 1) {
        for (const table of spec.tables) {
          const rows = tableRows(table).map((cells, r) =>
            cells.map((cell) => ({
              text: spansText(cell),
              options: { bold: r === 0, fill: r === 0 ? { color: "EDEFF3" } : undefined, color: DARK },
            })),
          );
          slide.addTable(rows, { x: 0.75, y, w: 11.9, fontSize: 14, border: { type: "solid", pt: 0.5, color: "CBD5E1" }, autoPage: true });
          y += 0.45 * rows.length + 0.2;
        }
      }
      if (spec.notes.length) slide.addNotes(spec.notes.join("\n\n"));
    });
  }
  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}
