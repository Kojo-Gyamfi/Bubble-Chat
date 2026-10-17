import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@/lib/llm";
import { buildMessages, CREATOR_ANSWER, FILE_ONLY_PROMPT, MAX_CONTEXT_MESSAGES, PHOTO_ONLY_PROMPT, systemPrompt } from "@/lib/prompt";

const turn = (i: number): LlmMessage[] => [
  { role: "user", content: `q${i}` },
  { role: "assistant", content: `a${i}` },
];

describe("buildMessages", () => {
  it("appends the new message to history", () => {
    expect(buildMessages(turn(1), "q2")).toEqual([...turn(1), { role: "user", content: "q2" }]);
  });

  it("caps the context at MAX_CONTEXT_MESSAGES, including the new message", () => {
    const history = Array.from({ length: 30 }, (_, i) => turn(i)).flat();
    const messages = buildMessages(history, "new");
    expect(messages.length).toBeLessThanOrEqual(MAX_CONTEXT_MESSAGES);
    expect(messages.at(-1)).toEqual({ role: "user", content: "new" });
  });

  it("always starts on a user turn", () => {
    const history = Array.from({ length: 30 }, (_, i) => turn(i)).flat();
    expect(buildMessages(history, "new")[0].role).toBe("user");
    expect(buildMessages([{ role: "assistant", content: "hi" }], "new")).toEqual([{ role: "user", content: "new" }]);
  });

  it("drops empty messages", () => {
    const history: LlmMessage[] = [
      { role: "user", content: "q" },
      { role: "assistant", content: "  " },
    ];
    expect(buildMessages(history, "new")).toEqual([
      { role: "user", content: "q" },
      { role: "user", content: "new" },
    ]);
  });
});

describe("systemPrompt", () => {
  it("includes the date", () => {
    expect(systemPrompt(new Date("2026-10-14T12:00:00Z"))).toContain("2026-10-14");
  });

  it("tells the model who built it, with the canned answer", () => {
    const prompt = systemPrompt();
    expect(prompt).toContain("Kwadwo Gyamfi");
    expect(prompt).toContain("Nana Kojo");
    expect(prompt).toContain(CREATOR_ANSWER);
    expect(CREATOR_ANSWER).toMatch(/built by \*\*Kwadwo Gyamfi\*\*, popularly known as \*\*Nana Kojo\*\*, a Software Developer/);
  });
});

describe("buildMessages with a photo", () => {
  const image = { data: "aGVsbG8=", mediaType: "image/jpeg" };

  it("attaches the photo to the new message only", () => {
    const messages = buildMessages(turn(1), "what is this?", image);
    expect(messages.at(-1)).toEqual({ role: "user", content: "what is this?", image });
    expect(messages.slice(0, -1).every((m) => !m.image)).toBe(true);
  });

  it("asks the model to describe a photo sent without text", () => {
    expect(buildMessages([], "", image).at(-1)).toEqual({ role: "user", content: PHOTO_ONLY_PROMPT, image });
  });
});

describe("buildMessages with a document", () => {
  const document = { name: "notes.txt", text: "Milk, eggs" };

  it("attaches the document to the new message", () => {
    expect(buildMessages([], "summarise", undefined, document).at(-1)).toEqual({ role: "user", content: "summarise", document });
  });

  it("asks for a summary when the file comes without a question", () => {
    expect(buildMessages([], "", undefined, document).at(-1)?.content).toBe(FILE_ONLY_PROMPT);
  });
});
