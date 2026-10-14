import { describe, expect, it } from "vitest";
import { chatRequestSchema, MAX_MESSAGE_CHARS, titleFrom } from "@/lib/chat/schema";

describe("titleFrom", () => {
  it("uses the first line, collapsing whitespace", () => {
    expect(titleFrom("  How do   I bake bread?\nMore details")).toBe("How do I bake bread?");
  });

  it("truncates long titles with an ellipsis", () => {
    const title = titleFrom("x".repeat(200));
    expect(title.length).toBe(60);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("chatRequestSchema", () => {
  const valid = {
    conversationId: "abcDEF123",
    userMessageId: "u1",
    assistantMessageId: "a1",
    message: "hello",
  };

  it("accepts a valid request and trims the message", () => {
    expect(chatRequestSchema.parse({ ...valid, message: "  hi  " }).message).toBe("hi");
  });

  it("rejects empty and oversized messages", () => {
    expect(chatRequestSchema.safeParse({ ...valid, message: "   " }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...valid, message: "x".repeat(MAX_MESSAGE_CHARS + 1) }).success).toBe(false);
  });

  it("rejects IDs that could escape the document path", () => {
    expect(chatRequestSchema.safeParse({ ...valid, conversationId: "../usage/x" }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...valid, userMessageId: "a/b" }).success).toBe(false);
  });
});
