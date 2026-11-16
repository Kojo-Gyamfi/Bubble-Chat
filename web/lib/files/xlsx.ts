import "server-only";

import ExcelJS from "exceljs";
import type { RootContent } from "mdast";
import { parseMarkdown, plainText, spansText, tableRows } from "@/lib/files/markdown";

interface Sheet {
  name: string;
  rows: string[][];
}

/** Excel's sheet-name rules: ≤31 chars, no []:*?/\, unique. */
function sheetName(wanted: string, used: Set<string>): string {
  const base = wanted.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)} ${n}`;
  used.add(name.toLowerCase());
  return name;
}

/**
 * Markdown → sheets: each table becomes a sheet, named after the heading just
 * before it. Text with no table becomes a one-column sheet, so nothing is lost.
 */
function toSheets(title: string, nodes: RootContent[]): Sheet[] {
  const sheets: Sheet[] = [];
  const loose: string[][] = [];
  let heading: string | null = null;
  for (const node of nodes) {
    if (node.type === "heading") {
      heading = plainText(node).trim();
    } else if (node.type === "table") {
      sheets.push({ name: heading ?? `Sheet ${sheets.length + 1}`, rows: tableRows(node).map((r) => r.map(spansText)) });
      heading = null;
    } else if (node.type === "list") {
      loose.push(...node.children.map((item) => [plainText(item).trim()]));
    } else {
      const text = plainText(node).trim();
      if (text) loose.push([text]);
    }
  }
  if (!sheets.length) sheets.push({ name: title, rows: loose });
  return sheets;
}

/** "1,200" → 1200, "12.5%" → 0.125 (formatted as %), "=SUM(B2:B9)" → formula; else text. */
function cellValue(raw: string): { value: ExcelJS.CellValue; numFmt?: string } {
  const text = raw.trim();
  if (/^=[A-Za-z(]/.test(text)) return { value: { formula: text.slice(1) } };
  const percent = /^(-?\d+(?:\.\d+)?)\s*%$/.exec(text);
  if (percent) return { value: Number(percent[1]) / 100, numFmt: "0.##%" };
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$|^-?\d+(\.\d+)?$/.test(text) && !/^0\d/.test(text)) {
    return { value: Number(text.replace(/,/g, "")), numFmt: text.includes(",") ? "#,##0.##" : undefined };
  }
  return { value: text };
}

/** Markdown tables → Excel workbook (bold, frozen header row with filters; sized columns). */
export async function markdownToXlsx(title: string, markdown: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Bubble";
  workbook.title = title;
  const used = new Set<string>();
  for (const sheet of toSheets(title, parseMarkdown(markdown).children)) {
    const ws = workbook.addWorksheet(sheetName(sheet.name, used));
    const hasHeader = sheet.rows.length > 1 && sheet.rows[0].length > 1;
    sheet.rows.forEach((cells, r) => {
      const row = ws.getRow(r + 1);
      cells.forEach((raw, c) => {
        const cell = row.getCell(c + 1);
        const { value, numFmt } = r === 0 && hasHeader ? { value: raw.trim(), numFmt: undefined } : cellValue(raw);
        cell.value = value;
        if (numFmt) cell.numFmt = numFmt;
        cell.alignment = { vertical: "top", wrapText: raw.length > 40 };
      });
      if (r === 0 && hasHeader) {
        row.font = { bold: true };
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEFF3" } };
      }
    });
    const columns = Math.max(1, ...sheet.rows.map((r) => r.length));
    for (let c = 1; c <= columns; c++) {
      const longest = Math.max(4, ...sheet.rows.map((r) => (r[c - 1] ?? "").length));
      ws.getColumn(c).width = Math.min(60, longest + 2);
    }
    if (hasHeader) {
      ws.views = [{ state: "frozen", ySplit: 1 }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns } };
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
