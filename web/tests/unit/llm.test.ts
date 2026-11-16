import Anthropic from "@anthropic-ai/sdk";
import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiSdkProvider,
  anthropicProvider,
  CLAUDE_HEDGE_AFTER_MS,
  type ClaudeClient,
  claudeEffort,
  DEFAULT_CHAIN,
  failureCooldownMs,
  formatSources,
  HEDGE_AFTER_MS,
  type LlmChunk,
  type LlmProvider,
  type LlmUsage,
  parseChain,
  rateLimitCooldownMs,
  resetCooldowns,
  streamWithFallback,
  toClaudeMessage,
  WEB_TOOLS,
} from "@/lib/llm";
import { NO_WEB_ACCESS_PROMPT, WEB_ACCESS_PROMPT } from "@/lib/prompt";

const opts = { system: "sys", maxTokens: 100 };
const messages = [{ role: "user" as const, content: "hi" }];

/** The reply text (statuses left out). */
async function collect(stream: AsyncIterable<LlmChunk>): Promise<string> {
  let text = "";
  for await (const chunk of stream) if (typeof chunk === "string") text += chunk;
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

type FakeEvent = Record<string, unknown>;
interface FakeTurn {
  events: FakeEvent[];
  stopReason?: string;
  content?: unknown[];
  usage?: Record<string, unknown>;
  /** Throw this from the stream instead of producing events. */
  error?: unknown;
  /** After the events, wait until the request is aborted (then throw like the SDK). */
  waitForAbort?: boolean;
}

/** Events for a whole text block, split into deltas. */
function textBlock(...deltas: string[]): FakeEvent[] {
  return [
    { type: "content_block_start", content_block: { type: "text", text: "" } },
    ...deltas.map((text) => ({ type: "content_block_delta", delta: { type: "text_delta", text } })),
    { type: "content_block_stop" },
  ];
}

/** Events for a server tool call (web_search, web_fetch, or code_execution with `code`). */
function toolBlock(name: string, code = ""): FakeEvent[] {
  return [
    { type: "content_block_start", content_block: { type: "server_tool_use", name, input: {} } },
    ...(code ? [{ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: JSON.stringify({ code }) } }] : []),
    { type: "content_block_stop" },
  ];
}

const USAGE = { input_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, output_tokens: 9 };

/**
 * A stand-in for the Anthropic client: each request plays the next turn's
 * events, then finalMessage() returns its stop reason, content and usage.
 * Records each request.
 */
function fakeClaude(...turns: FakeTurn[]) {
  const calls: { params: Record<string, unknown>; signal?: AbortSignal }[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>, options: { signal?: AbortSignal }) {
          const turn = turns[Math.min(calls.length, turns.length - 1)];
          calls.push({ params, signal: options.signal });
          const signal = options.signal;
          return {
            async *[Symbol.asyncIterator]() {
              if (turn.error) throw turn.error;
              yield { type: "message_start" };
              for (const event of turn.events) yield event;
              if (turn.waitForAbort) {
                await new Promise((_, reject) => {
                  if (signal?.aborted) reject(new Anthropic.APIUserAbortError());
                  signal?.addEventListener("abort", () => reject(new Anthropic.APIUserAbortError()));
                });
              }
            },
            finalMessage: async () => ({
              stop_reason: turn.stopReason ?? "end_turn",
              stop_details: turn.stopReason === "refusal" ? { category: "cyber" } : null,
              content: turn.content ?? [],
              usage: turn.usage ?? USAGE,
            }),
            abort: () => {},
          };
        },
      },
    },
  };
  return { client: client as unknown as ClaudeClient, calls };
}

async function chunksOf(stream: AsyncIterable<LlmChunk>): Promise<LlmChunk[]> {
  const out: LlmChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

const claude = (client: ClaudeClient) => anthropicProvider("claude:x", "claude-opus-5-5", "medium", client);

describe("anthropicProvider", () => {
  beforeEach(() => resetCooldowns());

  it("streams text, reports usage (cache tokens included) and sends the request settings", async () => {
    const { client, calls } = fakeClaude({ events: textBlock("Hello", " there") });
    let usage: LlmUsage | undefined;
    const provider = claude(client);
    const text = await collect(provider.stream(messages, { ...opts, onUsage: (u) => (usage = u) }));
    expect(text).toBe("Hello there");
    expect(usage).toEqual({ inputTokens: 125, outputTokens: 9, webSearches: 0, webFetches: 0 });
    expect(calls[0].params).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 100 + 6_144, // room for thinking and search filtering
      output_config: { effort: "medium" },
      tools: WEB_TOOLS,
      cache_control: { type: "ephemeral" },
      fallbacks: "default",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(calls[0].params.system).toBe(`sys\n\n${WEB_ACCESS_PROMPT}`);
    expect(provider.supportsImages).toBe(true);
    expect(provider.hedgeAfterMs).toBe(CLAUDE_HEDGE_AFTER_MS);
  });

  it("caps web searches and page fetches per message", () => {
    expect(WEB_TOOLS.map((t) => [t.name, t.max_uses])).toEqual([
      ["web_search", 3],
      ["web_fetch", 3],
    ]);
  });

  it("reports searching / reading while it uses web tools, then the answer", async () => {
    const { client } = fakeClaude({
      events: [...toolBlock("web_search"), ...toolBlock("web_fetch"), ...textBlock("It's sunny.")],
      usage: { ...USAGE, server_tool_use: { web_search_requests: 1, web_fetch_requests: 1 } },
    });
    let usage: LlmUsage | undefined;
    expect(await chunksOf(claude(client).stream(messages, { ...opts, onUsage: (u) => (usage = u) }))).toEqual([
      { status: "searching" },
      { status: "reading" },
      "It's sunny.",
    ]);
    expect(usage).toMatchObject({ webSearches: 1, webFetches: 1 });
  });

  it("tells what a code-execution step does (search filtering runs in code)", async () => {
    const { client } = fakeClaude({
      events: [...toolBlock("code_execution", 'r = await web_fetch({"url": "https://a.test"})'), ...textBlock("Done.")],
    });
    expect(await chunksOf(claude(client).stream(messages, opts))).toEqual([{ status: "working" }, { status: "reading" }, "Done."]);
  });

  it("drops a short progress note written before a tool call", async () => {
    const { client } = fakeClaude({
      events: [...textBlock("Let me search for that."), ...toolBlock("web_search"), ...textBlock("The answer.")],
    });
    expect(await collect(claude(client).stream(messages, opts))).toBe("The answer.");
  });

  it("keeps short answer pieces that aren't followed by a tool call (e.g. split by citations)", async () => {
    const { client } = fakeClaude({ events: [...textBlock("Accra is "), ...textBlock("the capital"), ...textBlock(".")] });
    expect(await collect(claude(client).stream(messages, opts))).toBe("Accra is the capital.");
  });

  it("streams a long answer live instead of holding it back", async () => {
    const long = "word ".repeat(60);
    const { client } = fakeClaude({ events: textBlock(long, " more") });
    const chunks = await chunksOf(claude(client).stream(messages, opts));
    expect(chunks).toEqual([long, " more"]); // released once long enough, then live
  });

  it("lists cited and opened pages under the answer", async () => {
    const { client } = fakeClaude({
      events: textBlock("Answer."),
      content: [
        {
          type: "text",
          text: "Answer.",
          citations: [
            { type: "web_search_result_location", url: "https://news.test/a", title: "Big [news]" },
            { type: "web_search_result_location", url: "https://news.test/a", title: "dup" },
          ],
        },
        { type: "web_fetch_tool_result", content: { type: "web_fetch_result", url: "https://www.page.test/x", content: { type: "document" } } },
        { type: "web_fetch_tool_result", content: { type: "web_fetch_tool_error", error_code: "url_not_accessible" } },
      ],
    });
    expect(await collect(claude(client).stream(messages, opts))).toBe(
      "Answer.\n\n**Sources**\n1. [Big \\[news\\]](<https://news.test/a>)\n2. [page.test](<https://www.page.test/x>)",
    );
  });

  it("lists the top search results when nothing was cited (results filtered in code)", async () => {
    const results = ["a", "b", "c", "d"].map((x) => ({ type: "web_search_result", url: `https://${x}.test/`, title: x.toUpperCase() }));
    const { client } = fakeClaude({
      events: textBlock("About $64,500."),
      content: [{ type: "web_search_tool_result", content: results }, { type: "text", text: "About $64,500." }],
    });
    expect(await collect(claude(client).stream(messages, opts))).toBe(
      "About $64,500.\n\n**Sources**\n1. [A](<https://a.test/>)\n2. [B](<https://b.test/>)\n3. [C](<https://c.test/>)",
    );
  });

  it("adds no sources to an answer that didn't use the web", async () => {
    const { client } = fakeClaude({ events: textBlock("Hi!"), content: [{ type: "text", text: "Hi!" }] });
    expect(await collect(claude(client).stream(messages, opts))).toBe("Hi!");
  });

  it("resumes a paused server tool loop", async () => {
    const paused = [{ type: "server_tool_use", name: "web_search", input: {} }];
    const { client, calls } = fakeClaude(
      { events: toolBlock("web_search"), stopReason: "pause_turn", content: paused },
      { events: textBlock("Finished.") },
    );
    expect(await collect(claude(client).stream(messages, opts))).toBe("Finished.");
    expect(calls).toHaveLength(2);
    expect(calls[1].params.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: paused },
    ]);
  });

  it("answers without web tools (and stops asking for a while) when they're turned off on the account", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = { type: "error", error: { type: "invalid_request_error", message: "web_search is not enabled for this organization" } };
    const off = new Anthropic.BadRequestError(400, body, undefined, new Headers());
    const { client, calls } = fakeClaude({ events: [], error: off }, { events: textBlock("Plain answer.") });
    expect(await collect(claude(client).stream(messages, opts))).toBe("Plain answer.");
    expect(calls[1].params.tools).toBeUndefined();
    expect(calls[1].params.system).toBe(`sys\n\n${NO_WEB_ACCESS_PROMPT}`);

    // The next message doesn't try the tools again.
    await collect(claude(client).stream(messages, opts));
    expect(calls[2].params.tools).toBeUndefined();
  });

  it("throws when Claude refuses before any text, so the chain falls back", async () => {
    const { client } = fakeClaude({ events: [], stopReason: "refusal" });
    await expect(collect(claude(client).stream(messages, opts))).rejects.toThrow("Claude declined to answer (cyber)");
  });

  it("ends quietly when the user presses Stop", async () => {
    const { client } = fakeClaude({ events: textBlock("word ".repeat(60)), waitForAbort: true });
    const stop = new AbortController();
    const chunks: LlmChunk[] = [];
    for await (const chunk of claude(client).stream(messages, { ...opts, abortSignal: stop.signal })) {
      chunks.push(chunk);
      stop.abort();
    }
    expect(chunks).toHaveLength(1);
  });

  it("falls back to the next model when Claude is rate-limited", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = fakeClaude({ events: [], error: new Anthropic.RateLimitError(429, {}, "rate limited", new Headers({ "retry-after": "30" })) });
    const chain = [claude(client), fake("gemini:b", ["from b"])];
    expect(await collect(streamWithFallback(chain, messages, opts))).toBe("from b");
  });
});

describe("formatSources", () => {
  it("is empty without sources and keeps only http(s) links", () => {
    expect(formatSources(new Map())).toBe("");
    expect(formatSources(new Map([["javascript:alert(1)", "x"]]))).toBe("");
  });

  it("caps the list", () => {
    const many = new Map(Array.from({ length: 9 }, (_, i) => [`https://s.test/${i}`, `S${i}`] as [string, string]));
    expect(formatSources(many).match(/^\d+\. /gm)).toHaveLength(5);
  });
});

describe("toClaudeMessage", () => {
  it("sends a photo as an image block before the text", () => {
    expect(toClaudeMessage({ role: "user", content: "what's this?", image: { data: "AAA", mediaType: "image/jpeg" } })).toEqual({
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAA" } },
        { type: "text", text: "what's this?" },
      ],
    });
  });

  it("sends a PDF as a document block, and other files as text", () => {
    const pdf = toClaudeMessage({ role: "user", content: "sum up", document: { name: "a.pdf", text: "x", pdf: "PDFDATA" } });
    expect(pdf.content).toEqual([
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "PDFDATA" } },
      { type: "text", text: "sum up\n\n[Attached file: a.pdf]" },
    ]);
    const docx = toClaudeMessage({ role: "user", content: "sum up", document: { name: "b.docx", text: "hello doc" } });
    expect(typeof docx.content).toBe("string");
    expect(docx.content).toContain("hello doc");
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

  it("reads claude entries", () => {
    expect(parseChain("claude:claude-opus-5-5@medium")).toEqual([{ provider: "claude", model: "claude-opus-5-5", reasoning: "medium" }]);
  });

  it("runs Claude at medium effort unless the chain says otherwise", () => {
    expect(claudeEffort(undefined)).toBe("medium");
    expect(claudeEffort("high")).toBe("high");
    expect(claudeEffort("low")).toBe("low");
    expect(claudeEffort("minimal")).toBe("low");
  });

  it("skips unknown providers and bad reasoning levels", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseChain("openai:gpt-9, gemini:x@turbo, groq:ok")).toEqual([{ provider: "groq", model: "ok", reasoning: undefined }]);
  });

  it("the default chain is valid, starts with Claude and keeps the free models as backup", () => {
    const chain = parseChain(DEFAULT_CHAIN);
    expect(chain.length).toBeGreaterThanOrEqual(7);
    expect(chain[0]).toEqual({ provider: "claude", model: "claude-opus-5-5", reasoning: undefined });
    expect(chain[1].provider).toBe("gemini");
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

  it("handles Anthropic errors: 429 Retry-After, 529 overloaded, bad key or no credit", () => {
    const headers = (h: Record<string, string> = {}) => new Headers(h);
    expect(failureCooldownMs(new Anthropic.RateLimitError(429, {}, "rate limited", headers({ "retry-after": "30" })))).toBe(30_000);
    expect(failureCooldownMs(Anthropic.APIError.generate(529, { type: "overloaded_error" }, "Overloaded", headers()))).toBe(300_000);
    expect(failureCooldownMs(new Anthropic.AuthenticationError(401, {}, "invalid x-api-key", headers()))).toBe(3_600_000);
    const noCredit = { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } };
    expect(failureCooldownMs(new Anthropic.BadRequestError(400, noCredit, "credit", headers()))).toBe(3_600_000);
    expect(failureCooldownMs(new Anthropic.BadRequestError(400, {}, "messages: field required", headers()))).toBeNull();
    expect(failureCooldownMs(new Anthropic.APIConnectionError({ message: "socket hang up" }))).toBe(300_000);
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

describe("streamWithFallback hedging (slow models)", () => {
  beforeEach(() => {
    resetCooldowns();
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.useRealTimers());

  /** Answers after `ms`, unless its abort signal fires first. */
  function delayed(name: string, ms: number, calls: string[], signals: AbortSignal[] = []): LlmProvider {
    return {
      name,
      supportsImages: false,
      async *stream(_messages, { abortSignal }) {
        calls.push(name);
        if (abortSignal) signals.push(abortSignal);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, ms);
          abortSignal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("aborted", "AbortError"));
          });
        });
        yield `from ${name}`;
      },
    };
  }

  it("starts the next model when the first is slow, and uses whichever answers first", async () => {
    const calls: string[] = [];
    const signals: AbortSignal[] = [];
    let model: string | undefined;
    const chain = [delayed("gemini:slow", 20_000, calls, signals), delayed("gemini:fast", 500, calls)];
    const reply = collect(streamWithFallback(chain, messages, { ...opts, onModel: (m) => (model = m) }));
    await vi.advanceTimersByTimeAsync(HEDGE_AFTER_MS + 500);
    expect(await reply).toBe("from gemini:fast");
    expect(model).toBe("gemini:fast");
    expect(signals[0].aborted).toBe(true); // the slow one was stopped

    // The slow one is skipped on the next request.
    const again = collect(streamWithFallback(chain, messages, opts));
    await vi.advanceTimersByTimeAsync(500);
    expect(await again).toBe("from gemini:fast");
    expect(calls).toEqual(["gemini:slow", "gemini:fast", "gemini:fast"]);
  });

  it("doesn't start another model when the first answers in time", async () => {
    const calls: string[] = [];
    const reply = collect(streamWithFallback([delayed("a", HEDGE_AFTER_MS - 500, calls), delayed("b", 10, calls)], messages, opts));
    await vi.advanceTimersByTimeAsync(HEDGE_AFTER_MS);
    expect(await reply).toBe("from a");
    expect(calls).toEqual(["a"]);
  });

  it("keeps the slow model if it still answers first", async () => {
    const calls: string[] = [];
    const chain = [delayed("a", HEDGE_AFTER_MS + 100, calls), delayed("b", 5_000, calls)];
    const reply = collect(streamWithFallback(chain, messages, opts));
    await vi.advanceTimersByTimeAsync(HEDGE_AFTER_MS + 100);
    expect(await reply).toBe("from a");
    // "a" answered, so it isn't sidelined.
    const again = collect(streamWithFallback(chain, messages, opts));
    await vi.advanceTimersByTimeAsync(HEDGE_AFTER_MS + 100);
    expect(await again).toBe("from a");
    expect(calls).toEqual(["a", "b", "a", "b"]);
  });

  it("waits longer before hedging a model with its own hedgeAfterMs (Claude thinks first)", async () => {
    const calls: string[] = [];
    const claude = { ...delayed("claude", HEDGE_AFTER_MS + 2_000, calls), hedgeAfterMs: CLAUDE_HEDGE_AFTER_MS };
    const reply = collect(streamWithFallback([claude, delayed("gemini", 10, calls)], messages, opts));
    await vi.advanceTimersByTimeAsync(HEDGE_AFTER_MS + 2_000);
    expect(await reply).toBe("from claude");
    expect(calls).toEqual(["claude"]); // no backup started at the default 3 s
  });

  /** Reports "searching" after 500 ms, then answers (or fails) after `answerMs` more. */
  function searching(name: string, answerMs: number, calls: string[], fail = false): LlmProvider {
    return {
      name,
      supportsImages: false,
      async *stream() {
        calls.push(name);
        await new Promise((r) => setTimeout(r, 500));
        yield { status: "searching" as const };
        await new Promise((r) => setTimeout(r, answerMs));
        if (fail) throw new Error(`${name} failed`);
        yield `from ${name}`;
      },
    };
  }

  async function chunksWithin(stream: AsyncIterable<LlmChunk>, ms: number): Promise<LlmChunk[]> {
    const out: LlmChunk[] = [];
    const done = (async () => {
      for await (const chunk of stream) out.push(chunk);
    })();
    await vi.advanceTimersByTimeAsync(ms);
    await done;
    return out;
  }

  it("doesn't hedge a model that reports it's busy (searching), and passes its status on", async () => {
    const calls: string[] = [];
    const chain = [searching("claude", 15_000, calls), delayed("gemini", 10, calls)];
    expect(await chunksWithin(streamWithFallback(chain, messages, opts), 16_000)).toEqual([{ status: "searching" }, "from claude"]);
    expect(calls).toEqual(["claude"]);
  });

  it("still falls back when a busy model fails before any text", async () => {
    const calls: string[] = [];
    const chain = [searching("claude", 2_000, calls, true), delayed("gemini", 10, calls)];
    expect(await chunksWithin(streamWithFallback(chain, messages, opts), 3_000)).toEqual([{ status: "searching" }, "from gemini"]);
  });

  it("doesn't sideline a busy model that loses to a backup started before it got busy", async () => {
    const calls: string[] = [];
    // Busy only after the hedge has started the backup, which then answers first.
    const late: LlmProvider = { ...searching("claude", 20_000, calls), hedgeAfterMs: 100 };
    const chain = [late, delayed("gemini", 1_000, calls)];
    expect(await collect(streamWithFallbackWithin(chain, 2_000))).toBe("from gemini");
    // Claude is tried first again next time.
    const again = streamWithFallback([delayed("claude", 10, calls), delayed("gemini", 10, calls)], messages, opts);
    expect(await chunksWithin(again, 20)).toEqual(["from claude"]);
  });

  function streamWithFallbackWithin(chain: LlmProvider[], ms: number): AsyncIterable<LlmChunk> {
    const chunks = chunksWithin(streamWithFallback(chain, messages, opts), ms);
    return (async function* () {
      yield* await chunks;
    })();
  }

  it("tries the next model right away when one fails fast", async () => {
    const calls: string[] = [];
    let done = false;
    const reply = collect(streamWithFallback([fake("a", ["x"], 0), delayed("b", 100, calls)], messages, opts)).finally(
      () => (done = true),
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(true); // didn't wait for the hedge delay
    expect(await reply).toBe("from b");
  });

  it("Stop ends every running model without sidelining them", async () => {
    const calls: string[] = [];
    const signals: AbortSignal[] = [];
    const stop = new AbortController();
    const chain = [delayed("a", 20_000, calls, signals), delayed("b", 20_000, calls, signals)];
    const reply = expect(collect(streamWithFallback(chain, messages, { ...opts, abortSignal: stop.signal }))).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(HEDGE_AFTER_MS + 100);
    expect(calls).toEqual(["a", "b"]);
    stop.abort();
    await reply;
    expect(signals.every((s) => s.aborted)).toBe(true);

    const again = collect(streamWithFallback([delayed("a", 10, calls), delayed("b", 10, calls)], messages, opts));
    await vi.advanceTimersByTimeAsync(10);
    expect(await again).toBe("from a");
  });

  // Real AI SDK streams end quietly (no error) when aborted.
  it("Stop doesn't sideline a model even when the streams end quietly", async () => {
    const calls: string[] = [];
    const stop = new AbortController();
    const quiet = (name: string, lag: number): LlmProvider => ({
      name,
      supportsImages: false,
      async *stream(_messages, { abortSignal }) {
        calls.push(name);
        await new Promise<void>((resolve) => abortSignal?.addEventListener("abort", () => setTimeout(resolve, lag)));
      },
    });
    // "b" (started second) ends first after the Stop.
    const reply = collect(streamWithFallback([quiet("a", 50), quiet("b", 0)], messages, { ...opts, abortSignal: stop.signal }));
    await vi.advanceTimersByTimeAsync(HEDGE_AFTER_MS + 100);
    stop.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(await reply).toBe("");

    const again = collect(streamWithFallback([delayed("a", 10, calls), delayed("b", 10, calls)], messages, opts));
    await vi.advanceTimersByTimeAsync(10);
    expect(await again).toBe("from a"); // "a" wasn't put on cooldown
  });
});
