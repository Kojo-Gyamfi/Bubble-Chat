import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { aiSdkProvider, type LlmProvider, type LlmUsage, streamWithFallback } from "@/lib/llm";

const opts = { system: "sys", maxTokens: 100 };
const messages = [{ role: "user" as const, content: "hi" }];

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const chunk of stream) text += chunk;
  return text;
}

/** Yields `chunks`, throwing before chunk index `failAt` if given. */
function fake(name: string, chunks: string[], failAt?: number): LlmProvider {
  return {
    name,
    async *stream() {
      for (const [i, chunk] of chunks.entries()) {
        if (i === failAt) throw new Error(`${name} failed`);
        yield chunk;
      }
    },
  };
}

describe("streamWithFallback", () => {
  it("uses the first provider when it works", async () => {
    const text = await collect(streamWithFallback([fake("a", ["he", "llo"]), fake("b", ["no"])], messages, opts));
    expect(text).toBe("hello");
  });

  it("falls back when the first provider fails before any text", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const text = await collect(streamWithFallback([fake("a", ["x"], 0), fake("b", ["from b"])], messages, opts));
    expect(text).toBe("from b");
  });

  it("does not fall back once text has been sent", async () => {
    const stream = streamWithFallback([fake("a", ["partial", "more"], 1), fake("b", ["from b"])], messages, opts);
    await expect(collect(stream)).rejects.toThrow("a failed");
  });

  it("throws when the last provider fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const stream = streamWithFallback([fake("a", ["x"], 0), fake("b", ["y"], 0)], messages, opts);
    await expect(collect(stream)).rejects.toThrow("b failed");
  });
});

const finish = {
  type: "finish" as const,
  finishReason: { unified: "stop" as const, raw: undefined },
  usage: {
    inputTokens: { total: 7, noCache: 7, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 3, text: 3, reasoning: undefined },
  },
};

function streamingModel(text: string) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "t" },
          ...text.split(" ").map((word, i) => ({ type: "text-delta" as const, id: "t", delta: i ? ` ${word}` : word })),
          { type: "text-end", id: "t" },
          finish,
        ],
      }),
    }),
  });
}

function rateLimitedModel() {
  return new MockLanguageModelV4({
    doStream: async () => {
      throw new APICallError({
        message: "Resource exhausted",
        url: "https://example.test",
        requestBodyValues: {},
        statusCode: 429,
        isRetryable: true,
      });
    },
  });
}

describe("aiSdkProvider", () => {
  it("streams text and reports token usage", async () => {
    const model = streamingModel("Hello there");
    let usage: LlmUsage | undefined;
    const text = await collect(aiSdkProvider("mock", model).stream(messages, { ...opts, onUsage: (u) => (usage = u) }));
    expect(text).toBe("Hello there");
    expect(usage).toEqual({ inputTokens: 7, outputTokens: 3 });
    expect(model.doStreamCalls[0].maxOutputTokens).toBe(100);
  });

  // The AI SDK's textStream swallows errors; the adapter must surface them so
  // a rate-limited provider triggers the fallback.
  it("throws when the provider rejects the request (e.g. 429)", async () => {
    await expect(collect(aiSdkProvider("mock", rateLimitedModel()).stream(messages, opts))).rejects.toThrow(
      "Resource exhausted",
    );
  });

  it("throws on a mid-stream error part", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({ chunks: [{ type: "error", error: new Error("boom") }] }),
      }),
    });
    await expect(collect(aiSdkProvider("mock", model).stream(messages, opts))).rejects.toThrow("boom");
  });

  it("falls back from a rate-limited AI SDK provider end to end", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const chain = [aiSdkProvider("gemini", rateLimitedModel()), aiSdkProvider("groq", streamingModel("from backup"))];
    expect(await collect(streamWithFallback(chain, messages, opts))).toBe("from backup");
  });
});
