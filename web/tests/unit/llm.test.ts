import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiSdkProvider,
  DEFAULT_CHAIN,
  failureCooldownMs,
  type LlmProvider,
  type LlmUsage,
  parseChain,
  rateLimitCooldownMs,
  resetCooldowns,
  streamWithFallback,
} from "@/lib/llm";

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
    supportsImages: false,
    async *stream() {
      for (const [i, chunk] of chunks.entries()) {
        if (i === failAt) throw new Error(`${name} failed`);
        yield chunk;
      }
    },
  };
}

describe("streamWithFallback", () => {
  beforeEach(() => resetCooldowns());

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

  it("passes the reasoning effort through to the model call", async () => {
    const model = streamingModel("ok");
    await collect(aiSdkProvider("groq", model, { reasoning: "low" }).stream(messages, opts));
    expect(model.doStreamCalls[0].reasoning).toBe("low");
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

// The real body Gemini returned when gemini-2.5-flash's free daily quota ran out (trimmed).
const GEMINI_DAILY_429 = JSON.stringify({
  error: {
    code: 429,
    message:
      "You exceeded your current quota...\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-2.5-flash\nPlease retry in 14h1m21.172325537s.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "50481s" },
    ],
  },
});

function apiError(statusCode: number, responseBody?: string, message = "rate limited", headers?: Record<string, string>) {
  return new APICallError({
    message,
    url: "https://example.test",
    requestBodyValues: {},
    statusCode,
    responseBody,
    responseHeaders: headers,
    isRetryable: statusCode === 429,
  });
}

describe("parseChain", () => {
  it("reads provider:model entries with an optional @reasoning", () => {
    expect(parseChain(" gemini:gemini-3.8-flash@low , groq:openai/gpt-oss-120b ")).toEqual([
      { provider: "gemini", model: "gemini-3.8-flash", reasoning: "low" },
      { provider: "groq", model: "openai/gpt-oss-120b", reasoning: undefined },
    ]);
  });

  it("skips unknown providers and bad reasoning levels", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseChain("openai:gpt-9, gemini:x@turbo, groq:ok")).toEqual([{ provider: "groq", model: "ok", reasoning: undefined }]);
  });

  it("the default chain is valid and starts with Gemini", () => {
    const chain = parseChain(DEFAULT_CHAIN);
    expect(chain.length).toBeGreaterThanOrEqual(6);
    expect(chain[0].provider).toBe("gemini");
    expect(chain.at(-1)?.provider).toBe("groq");
  });
});

describe("rateLimitCooldownMs", () => {
  it("uses Gemini's RetryInfo for a daily quota (until the reset)", () => {
    expect(rateLimitCooldownMs(apiError(429, GEMINI_DAILY_429))).toBe(50_481_000);
  });

  it("reads Groq's 'try again in' hint", () => {
    const body = JSON.stringify({ error: { message: "Rate limit reached for model `openai/gpt-oss-120b` on tokens per day (TPD): Limit 200000. Please try again in 7m12.48s. Need more tokens?" } });
    expect(rateLimitCooldownMs(apiError(429, body))).toBe(432_480);
  });

  it("falls back to Retry-After, then to an hour (daily) or a minute", () => {
    expect(rateLimitCooldownMs(apiError(429, "{}", "slow down", { "retry-after": "30" }))).toBe(30_000);
    expect(rateLimitCooldownMs(apiError(429, '{"quotaId":"GenerateRequestsPerDayPerProjectPerModel"}'))).toBe(3_600_000);
    expect(rateLimitCooldownMs(apiError(429, "{}"))).toBe(60_000);
  });

  it("ignores other errors", () => {
    expect(rateLimitCooldownMs(apiError(500, "{}"))).toBeNull();
    expect(rateLimitCooldownMs(new Error("network"))).toBeNull();
  });
});

describe("failureCooldownMs", () => {
  it("uses the rate limit wait for a 429", () => {
    expect(failureCooldownMs(apiError(429, GEMINI_DAILY_429))).toBe(50_481_000);
  });

  it("skips a model for a few minutes after a timeout, network error or 5xx", () => {
    expect(failureCooldownMs(new DOMException("timed out", "TimeoutError"))).toBe(300_000);
    expect(failureCooldownMs(new Error("network"))).toBe(300_000);
    expect(failureCooldownMs(apiError(503, "{}", "overloaded"))).toBe(300_000);
  });

  it("doesn't blame the model for a bad request", () => {
    expect(failureCooldownMs(apiError(400, "{}", "invalid argument"))).toBeNull();
  });
});

describe("streamWithFallback cooldowns", () => {
  beforeEach(() => resetCooldowns());

  function limited(name: string, calls: string[]): LlmProvider {
    return {
      name,
      supportsImages: false,
      async *stream() {
        calls.push(name);
        throw apiError(429, GEMINI_DAILY_429);
      },
    };
  }
  function working(name: string, calls: string[]): LlmProvider {
    return {
      name,
      supportsImages: false,
      async *stream() {
        calls.push(name);
        yield `from ${name}`;
      },
    };
  }

  it("skips an exhausted model on later requests until it resets", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: string[] = [];
    const chain = [limited("gemini:a", calls), working("gemini:b", calls)];
    expect(await collect(streamWithFallback(chain, messages, opts))).toBe("from gemini:b");
    expect(await collect(streamWithFallback(chain, messages, opts))).toBe("from gemini:b");
    expect(calls).toEqual(["gemini:a", "gemini:b", "gemini:b"]); // "a" not asked the second time
  });

  it("reports which model answered", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: string[] = [];
    let model: string | undefined;
    await collect(streamWithFallback([limited("gemini:a", calls), working("groq:b", calls)], messages, { ...opts, onModel: (m) => (model = m) }));
    expect(model).toBe("groq:b");
  });

  it("skips a model that timed out on later requests", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: string[] = [];
    const stuck: LlmProvider = {
      name: "gemini:slow",
      supportsImages: false,
      async *stream() {
        calls.push("gemini:slow");
        throw new DOMException("timed out", "TimeoutError");
      },
    };
    const chain = [stuck, working("gemini:b", calls)];
    await collect(streamWithFallback(chain, messages, opts));
    await collect(streamWithFallback(chain, messages, opts));
    expect(calls).toEqual(["gemini:slow", "gemini:b", "gemini:b"]);
  });

  it("doesn't put a model on cooldown when the user pressed Stop", async () => {
    const calls: string[] = [];
    const stop = new AbortController();
    const aborted: LlmProvider = {
      name: "gemini:a",
      supportsImages: false,
      async *stream() {
        calls.push("gemini:a");
        stop.abort();
        throw new DOMException("aborted", "AbortError");
      },
    };
    const chain = [aborted, working("gemini:b", calls)];
    await expect(collect(streamWithFallback(chain, messages, { ...opts, abortSignal: stop.signal }))).rejects.toThrow();
    await collect(streamWithFallback([working("gemini:a", calls), working("gemini:b", calls)], messages, opts));
    expect(calls).toEqual(["gemini:a", "gemini:a"]);
  });

  it("still tries everything when every model is cooling down", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: string[] = [];
    const chain = [limited("gemini:a", calls), limited("gemini:b", calls)];
    await expect(collect(streamWithFallback(chain, messages, opts))).rejects.toThrow();
    await expect(collect(streamWithFallback(chain, messages, opts))).rejects.toThrow();
    expect(calls).toEqual(["gemini:a", "gemini:b", "gemini:a", "gemini:b"]);
  });
});
