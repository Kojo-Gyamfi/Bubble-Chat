import { describe, expect, it } from "vitest";
import type { LlmMessage } from "@/lib/llm";
import { buildMessages, MAX_CONTEXT_MESSAGES, systemPrompt } from "@/lib/prompt";

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
});
