import { describe, expect, it } from "vitest";
import { speechChunks, speechText } from "@/lib/speech";

describe("speechText", () => {
  it("strips Markdown so it reads naturally", () => {
    expect(speechText("## Title\n**Bold** and *italic* with `code` and [a link](https://x.dev).")).toBe(
      "Title\nBold and italic with code and a link.",
    );
  });

  it("skips code blocks and bare URLs", () => {
    const text = speechText("Run this:\n```ts\nconst a = 1;\n```\nSee https://example.com/page");
    expect(text).toContain("Code block omitted.");
    expect(text).not.toContain("const a");
    expect(text).toContain("See link");
  });

  it("drops list markers and the stopped note's formatting", () => {
    expect(speechText("- one\n- two\n\n_(stopped)_")).toBe("one\ntwo\nstopped");
  });
});

describe("speechChunks", () => {
  it("keeps every word, in order, in pieces no longer than the max", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const chunks = speechChunks(text, 100);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(text);
  });

  it("splits a single very long sentence", () => {
    const long = `${"word ".repeat(100).trim()}.`;
    const chunks = speechChunks(long, 80);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 80)).toBe(true);
  });
});
