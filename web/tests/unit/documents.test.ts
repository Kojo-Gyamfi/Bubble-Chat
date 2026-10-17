import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { documentAsText, MAX_FILE_TEXT_CHARS, readDocument } from "@/lib/chat/documents";
import { chatRequestSchema, FILE_MEDIA_TYPES, MAX_FILE_BYTES } from "@/lib/chat/schema";

const b64 = (data: Uint8Array | string) => Buffer.from(data).toString("base64");

/** A one-page PDF with real text, xref offsets computed so pdf.js reads it cleanly. */
function makePdf(line: string): Uint8Array {
  const stream = `BT /F1 18 Tf 72 720 Td (${line}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

/** A minimal .docx (a zip with the three parts Word needs). */
async function makeDocx(paragraphs: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("") +
      "</w:body></w:document>",
  );
  return zip.generateAsync({ type: "uint8array" });
}

describe("readDocument", () => {
  it("reads text files as UTF-8 and tidies whitespace", async () => {
    const doc = await readDocument({ name: "notes.md", mediaType: FILE_MEDIA_TYPES.text, data: b64("# Plan\r\n\r\n\r\n\r\nBuy   milk ✓") });
    expect(doc.text).toBe("# Plan\n\nBuy milk ✓");
    expect(doc.pdf).toBeUndefined();
    expect(doc.size).toBeGreaterThan(0);
  });

  it("rejects binary data with a text name", async () => {
    const binary = new Uint8Array(200).map((_, i) => (i % 3 === 0 ? 0 : 200));
    await expect(readDocument({ name: "x.txt", mediaType: FILE_MEDIA_TYPES.text, data: b64(binary) })).rejects.toThrow(
      /Couldn't read that file/,
    );
  });

  it("extracts the text of a Word document", async () => {
    const docx = await makeDocx(["Quarterly report", "Sales grew by 12 percent."]);
    const doc = await readDocument({ name: "report.docx", mediaType: FILE_MEDIA_TYPES.docx, data: b64(docx) });
    expect(doc.text).toContain("Quarterly report");
    expect(doc.text).toContain("Sales grew by 12 percent.");
  });

  it("extracts PDF text and keeps the PDF itself for models that read files", async () => {
    const pdf = makePdf("Hello from a PDF page");
    const doc = await readDocument({ name: "hello.pdf", mediaType: FILE_MEDIA_TYPES.pdf, data: b64(pdf) });
    expect(doc.text).toContain("Hello from a PDF page");
    expect(doc.pdf).toBe(b64(pdf));
  });

  it("gives a friendly error for a corrupt PDF or Word file", async () => {
    await expect(readDocument({ name: "bad.pdf", mediaType: FILE_MEDIA_TYPES.pdf, data: b64("not a pdf at all") })).rejects.toThrow(
      /Couldn't read that file/,
    );
    await expect(readDocument({ name: "bad.docx", mediaType: FILE_MEDIA_TYPES.docx, data: b64("nope") })).rejects.toThrow(
      /Couldn't read that file/,
    );
  });

  it("cuts very long documents and says so", async () => {
    const doc = await readDocument({ name: "long.txt", mediaType: FILE_MEDIA_TYPES.text, data: b64("word ".repeat(30_000)) });
    expect(doc.text.length).toBeLessThan(MAX_FILE_TEXT_CHARS + 200);
    expect(doc.text).toMatch(/cut off/);
  });
});

describe("documentAsText", () => {
  it("labels the document and notes scans without text", () => {
    expect(documentAsText("a.txt", "hi")).toBe("[Attached file: a.txt]\nhi");
    expect(documentAsText("scan.pdf", "")).toMatch(/scanned/);
  });
});

describe("chatRequestSchema with a file", () => {
  const base = { conversationId: "c1", userMessageId: "u1", assistantMessageId: "a1" };
  const file = { name: "notes.txt", mediaType: FILE_MEDIA_TYPES.text, data: b64("hello") };

  it("accepts a file without text", () => {
    expect(chatRequestSchema.safeParse({ ...base, file }).success).toBe(true);
  });

  it("rejects unknown types, path-like names, oversized files and photo + file together", () => {
    expect(chatRequestSchema.safeParse({ ...base, file: { ...file, mediaType: "application/zip" } }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...base, file: { ...file, name: "../../etc/passwd" } }).success).toBe(false);
    expect(
      chatRequestSchema.safeParse({ ...base, file: { ...file, data: "A".repeat(Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4) } }).success,
    ).toBe(false);
    const image = { mediaType: "image/jpeg", data: "aGk=", thumbnail: "data:image/jpeg;base64,aGk=" };
    expect(chatRequestSchema.safeParse({ ...base, file, image }).success).toBe(false);
  });
});
