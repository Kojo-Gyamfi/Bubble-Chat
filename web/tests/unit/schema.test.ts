import { describe, expect, it } from "vitest";
import { chatRequestSchema, MAX_IMAGE_BASE64_CHARS, MAX_MESSAGE_CHARS, titleFrom } from "@/lib/chat/schema";

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

describe("chatRequestSchema with a photo", () => {
  const base = { conversationId: "c1", userMessageId: "u1", assistantMessageId: "a1" };
  const image = { mediaType: "image/jpeg", data: "aGVsbG8=", thumbnail: "data:image/jpeg;base64,aGk=" };

  it("accepts a photo without text", () => {
    const parsed = chatRequestSchema.parse({ ...base, image });
    expect(parsed.message).toBe("");
    expect(parsed.image?.mediaType).toBe("image/jpeg");
  });

  it("still rejects a request with neither text nor photo", () => {
    expect(chatRequestSchema.safeParse({ ...base, message: "  " }).success).toBe(false);
  });

  it("rejects unsupported types, oversized images and non-data-URL thumbnails", () => {
    expect(chatRequestSchema.safeParse({ ...base, image: { ...image, mediaType: "image/gif" } }).success).toBe(false);
    expect(
      chatRequestSchema.safeParse({ ...base, image: { ...image, data: "A".repeat(MAX_IMAGE_BASE64_CHARS + 4) } }).success,
    ).toBe(false);
    expect(
      chatRequestSchema.safeParse({ ...base, image: { ...image, thumbnail: "https://evil.example/x.jpg" } }).success,
    ).toBe(false);
    expect(chatRequestSchema.safeParse({ ...base, image: { ...image, data: "not base64!" } }).success).toBe(false);
  });

  it("titles a photo-only conversation", () => {
    expect(titleFrom("")).toBe("📷 Photo");
  });
});
