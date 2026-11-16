import ExcelJS from "exceljs";
import JSZip from "jszip";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it, vi } from "vitest";
import { fileSpec, replaceFileBlocks, splitFileBlocks, toFileFormat } from "@/lib/chat/file-blocks";
import { encodeStatus, parseReplyStream } from "@/lib/chat/status";
import { renderFile } from "@/lib/files/render";
import { signFile, verifyFileSignature } from "@/lib/files/store";
import { type FileMaker, withFiles } from "@/lib/files/stream";

const DOC = `# Trip to Kumasi

A short plan for **two days**, with *italics*, \`code\` and a [link](https://example.com).

## Day 1

- Visit Manhyia Palace
- Kejetia market
  - Buy kente

1. Breakfast
2. Lunch

| Item | Cost (GH₵) |
| --- | ---: |
| Bus | 120 |
| Hotel | 450 |

> Remember water.

Twi: Ɛte sɛn? Me ho yɛ. Ɔdɔ.

Ligatures: five fine flu.
`;

describe("file blocks", () => {
  it("reads format and name, with aliases and an extension in the name", () => {
    expect(toFileFormat("Word")).toBe("docx");
    expect(toFileFormat(".PDF")).toBe("pdf");
    expect(toFileFormat("excel")).toBe("xlsx");
    expect(toFileFormat("slides")).toBe("pptx");
    expect(toFileFormat("zip")).toBeNull();
    expect(fileSpec({ name: "Budget 2026.xlsx" })).toEqual({ format: "xlsx", name: "Budget 2026" });
    expect(fileSpec({ format: "pdf", name: 'a/b:c*"d"' })).toEqual({ format: "pdf", name: "a b c d" });
    expect(fileSpec({})).toEqual({ format: "docx", name: "Document" });
  });

  it("splits a reply into text and file parts", () => {
    const content = `Here it is.\n<bubble-file format="pdf" name="Plan" href="https://x.test/f">\n# Plan\n</bubble-file>\nEnjoy!`;
    expect(splitFileBlocks(content)).toEqual([
      { type: "text", text: "Here it is.\n" },
      { type: "file", format: "pdf", name: "Plan", href: "https://x.test/f", content: "# Plan", complete: true },
      { type: "text", text: "\nEnjoy!" },
    ]);
    expect(splitFileBlocks(`Hi <bubble-file format="docx" name="X">partial`)[1]).toMatchObject({ complete: false, content: "partial" });
    expect(replaceFileBlocks(content, (f) => `[${f.name}]`)).toBe("Here it is.\n[Plan]\nEnjoy!");
  });
});

describe("withFiles", () => {
  async function run(chunks: (string | { status: "searching" })[], maker: Partial<FileMaker> = {}) {
    const made: { format: string; name: string; content: string }[] = [];
    const make: FileMaker["make"] =
      maker.make ??
      (async (file) => {
        made.push(file);
        return { href: "https://app.test/api/files/u/c/f/Plan.docx?s=sig" };
      });
    async function* source() {
      yield* chunks;
    }
    const out: (string | { status: string })[] = [];
    for await (const chunk of withFiles(source(), { make, signal: maker.signal })) out.push(chunk);
    const raw = out.map((c) => (typeof c === "string" ? c : encodeStatus(c.status as "writing"))).join("");
    return { out, made, text: parseReplyStream(raw).text };
  }

  it("passes ordinary replies through untouched", async () => {
    const { out, made } = await run(["Hello ", "there <b>", "!"]);
    expect(out).toEqual(["Hello ", "there <b>", "!"]);
    expect(made).toEqual([]);
  });

  it("holds a file block back, builds it and sends it with its download link", async () => {
    const { out, made, text } = await run([
      "Here's your plan.\n<bubble-fi",
      'le format="word" name="Trip plan.docx">\n# Trip\n\n- a\n</bubble-',
      "file>",
    ]);
    expect(made).toEqual([{ format: "docx", name: "Trip plan", content: "# Trip\n\n- a" }]);
    expect(out).toContainEqual({ status: "writing" });
    expect(text).toBe(
      'Here\'s your plan.\n<bubble-file format="docx" name="Trip plan" href="https://app.test/api/files/u/c/f/Plan.docx?s=sig">\n# Trip\n\n- a\n</bubble-file>',
    );
    // The raw block never reached the client before it was finished.
    expect(out.filter((c) => typeof c === "string" && c.includes("# Trip"))).toHaveLength(1);
  });

  it("falls back to the content as text if the file can't be built", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { text } = await run([`Sure.<bubble-file format="pdf" name="X">Body text</bubble-file>`], {
      make: async () => {
        throw new Error("boom");
      },
    });
    expect(text).toContain("couldn't create the PDF file");
    expect(text).toContain("Body text");
    expect(text).not.toContain("<bubble-file");
  });

  it("still builds a file the reply cut off, and says it may be incomplete", async () => {
    const { made, text } = await run([`<bubble-file format="xlsx" name="T">| a |\n| - |\n| 1 |`]);
    expect(made[0]).toMatchObject({ format: "xlsx", content: "| a |\n| - |\n| 1 |" });
    expect(text).toContain("may be incomplete");
  });

  it("doesn't build a file when the user stopped the reply", async () => {
    const stop = new AbortController();
    stop.abort();
    const { made, text } = await run([`<bubble-file format="docx" name="T">half a doc`], { signal: stop.signal });
    expect(made).toEqual([]);
    expect(text).toContain("half a doc");
  });

  it("passes statuses through", async () => {
    const { out } = await run([{ status: "searching" }, "Done"]);
    expect(out).toEqual([{ status: "searching" }, "Done"]);
  });
});

describe("download links", () => {
  it("are signed per file", () => {
    const sig = signFile("u1", "c1", "f1");
    expect(verifyFileSignature("u1", "c1", "f1", sig)).toBe(true);
    expect(verifyFileSignature("u2", "c1", "f1", sig)).toBe(false);
    expect(verifyFileSignature("u1", "c1", "f2", sig)).toBe(false);
    expect(verifyFileSignature("u1", "c1", "f1", "nope")).toBe(false);
  });
});

describe("renderFile", () => {
  it("builds a Word document with the text, list numbering and table", async () => {
    const { data, mimeType } = await renderFile("docx", "Trip", DOC);
    expect(mimeType).toContain("wordprocessingml");
    const xml = await (await JSZip.loadAsync(data)).file("word/document.xml")!.async("string");
    expect(xml).toContain("Trip to Kumasi");
    expect(xml).toContain("Manhyia Palace");
    expect(xml).toContain("GH₵");
    expect(xml).toContain("Ɛte sɛn?");
    expect(xml).toContain("w:tbl");
    expect(xml).toContain("w:hyperlink");
  });

  it("builds a PDF whose text (incl. Twi letters) can be read back", async () => {
    const { data, mimeType } = await renderFile("pdf", "Trip", `${DOC}\nEmoji 😀 dropped.`);
    expect(mimeType).toBe("application/pdf");
    expect(data.subarray(0, 5).toString()).toBe("%PDF-");
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(data)), { mergePages: true });
    expect(text).toContain("Trip to Kumasi");
    expect(text).toContain("Manhyia Palace");
    expect(text).toContain("Ɛte sɛn");
    expect(text).toContain("five fine flu"); // no ligatures: copied text keeps every letter
    expect(text).toMatch(/Emoji\s+dropped\./);
    expect(text).not.toContain("😀");
  });

  it("refuses to read local files or URLs named in the content (images)", async () => {
    const { data } = await renderFile("pdf", "X", "![secret](/etc/passwd) and ![web](https://example.com/a.png)\n\nok");
    expect(data.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("builds an Excel workbook: one sheet per table, numbers as numbers, formulas kept", async () => {
    const md = `## Expenses\n\n| Item | Cost | Share |\n| --- | --- | --- |\n| Bus | 1,200 | 25% |\n| Hotel | 450 | 75% |\n| Total | =SUM(B2:B3) | |\n\n## People\n\n| Name |\n| --- |\n| Ama |`;
    const { data } = await renderFile("xlsx", "Budget", md);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as ArrayBuffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(["Expenses", "People"]);
    const ws = wb.getWorksheet("Expenses")!;
    expect(ws.getCell("A1").value).toBe("Item");
    expect(ws.getCell("B2").value).toBe(1200);
    expect(ws.getCell("C2").value).toBe(0.25);
    expect(ws.getCell("B4").value).toMatchObject({ formula: "SUM(B2:B3)" });
    expect(ws.getRow(1).font?.bold).toBe(true);
  });

  it("makes a one-column sheet when there is no table", async () => {
    const { data } = await renderFile("xlsx", "Notes", "- one\n- two");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as ArrayBuffer);
    expect(wb.worksheets[0].getCell("A2").value).toBe("two");
  });

  it("builds a PowerPoint with a cover slide and one slide per ## heading", async () => {
    const md = `# Kumasi trip\nTwo days in the Garden City\n\n## Day 1\n- Palace\n- Market\n> Say hi to everyone\n\n## Costs\n| Item | GH₵ |\n| --- | --- |\n| Bus | 120 |`;
    const { data, mimeType } = await renderFile("pptx", "Trip", md);
    expect(mimeType).toContain("presentationml");
    const zip = await JSZip.loadAsync(data);
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slides).toHaveLength(3);
    const all = (await Promise.all(slides.map((f) => zip.file(f)!.async("string")))).join("");
    expect(all).toContain("Kumasi trip");
    expect(all).toContain("Two days in the Garden City");
    expect(all).toContain("Palace");
    expect(all).toContain("GH₵");
    const notes = Object.keys(zip.files).filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f));
    const notesXml = (await Promise.all(notes.map((f) => zip.file(f)!.async("string")))).join("");
    expect(notesXml).toContain("Say hi to everyone");
  });

  it("splits a long slide over continued slides", async () => {
    const bullets = Array.from({ length: 12 }, (_, i) => `- Point ${i + 1}`).join("\n");
    const { data } = await renderFile("pptx", "Long", `# Deck\n\n## Many points\n${bullets}`);
    const zip = await JSZip.loadAsync(data);
    expect(Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))).toHaveLength(3); // cover + 2
  });
});
