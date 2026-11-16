import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { APICallError, type LanguageModel, type ModelMessage, streamText } from "ai";
import { HttpError } from "@/lib/auth";
import { documentAsText } from "@/lib/chat/documents";
import { mockReply } from "@/lib/chat/mock";
import type { ReplyStatus } from "@/lib/chat/status";
import { NO_WEB_ACCESS_PROMPT, WEB_ACCESS_PROMPT } from "@/lib/prompt";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
  /** A photo sent with this (user) message; only the newest message carries one. */
  image?: { data: string; mediaType: string };
  /**
   * An attached document. Models that read files get the PDF itself; others
   * (and every non-PDF) get its extracted text appended to the message.
   */
  document?: { name: string; text: string; pdf?: string };
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  /** Web searches / page fetches the model ran (Claude only; billed per search). */
  webSearches?: number;
  webFetches?: number;
}

/**
 * A piece of the reply: text, or a status update (e.g. "searching") while the
 * model uses a tool. A status also tells the chain the model is busy, not stuck.
 */
export type LlmChunk = string | { status: ReplyStatus };

export interface StreamOptions {
  system: string;
  maxTokens: number;
  onUsage?: (usage: LlmUsage) => void;
  /** Which model ended up answering (e.g. "gemini:gemini-3.6-flash"). */
  onModel?: (name: string) => void;
  /** The user pressed Stop: end the reply now. */
  abortSignal?: AbortSignal;
}

export interface LlmProvider {
  name: string;
  /** Can read images and PDFs (Gemini, Claude). Photo messages skip providers that can't. */
  supportsImages: boolean;
  /** How long to wait for its first word before also starting the next model (default HEDGE_AFTER_MS). */
  hedgeAfterMs?: number;
  stream(messages: LlmMessage[], opts: StreamOptions): AsyncIterable<LlmChunk>;
}

type Reasoning = NonNullable<Parameters<typeof streamText>[0]["reasoning"]>;

/** Wraps an AI SDK model. Provider errors (e.g. 429) are thrown, not swallowed. */
export function aiSdkProvider(
  name: string,
  model: LanguageModel,
  extra: { reasoning?: Reasoning } = {},
  supportsImages = false,
): LlmProvider {
  return {
    name,
    supportsImages,
    async *stream(messages, { system, maxTokens, onUsage, abortSignal }) {
      const result = streamText({
        model,
        // These models can't browse: say so rather than pretend to have opened a link.
        instructions: `${system}\n\n${NO_WEB_ACCESS_PROMPT}`,
        messages: messages.map((m) => toModelMessage(m, supportsImages)),
        abortSignal,
        maxOutputTokens: maxTokens,
        // Fall back to the next model instead of retrying a rate-limited one.
        maxRetries: 0,
        // A healthy model starts in 1-6 s; give up on a stuck one quickly and
        // fall back. Stay well inside the route's maxDuration.
        // A whole document (when a file is asked for) can take a minute or two.
        timeout: { firstChunkMs: 10_000, totalMs: 150_000 },
        // Errors arrive as stream parts (below) and streamWithFallback logs one line;
        // the SDK's default would also dump the whole request/response.
        onError: () => {},
        ...extra,
      });
      for await (const part of result.stream) {
        switch (part.type) {
          case "text-delta":
            if (part.text) yield part.text;
            break;
          case "error":
            throw part.error;
          case "finish":
            onUsage?.({
              inputTokens: part.totalUsage.inputTokens ?? 0,
              outputTokens: part.totalUsage.outputTokens ?? 0,
            });
            break;
        }
      }
    },
  };
}

/** Attachments go before the text, as Gemini recommends. */
function toModelMessage(m: LlmMessage, readsFiles: boolean): ModelMessage {
  if (m.role === "assistant") return { role: "assistant", content: m.content };
  const doc = m.document;
  if (doc && !(readsFiles && doc.pdf)) {
    return { role: "user", content: `${m.content}\n\n${documentAsText(doc.name, doc.text)}` };
  }
  if (doc?.pdf) {
    return {
      role: "user",
      content: [
        { type: "file", data: doc.pdf, mediaType: "application/pdf", filename: doc.name },
        { type: "text", text: `${m.content}\n\n[Attached file: ${doc.name}]` },
      ],
    };
  }
  if (!m.image) return { role: "user", content: m.content };
  return {
    role: "user",
    content: [
      { type: "file", data: m.image.data, mediaType: m.image.mediaType },
      { type: "text", text: m.content },
    ],
  };
}

// ---- Claude (official Anthropic SDK) ----

export type ClaudeEffort = "low" | "medium" | "high";

/** The part of the Anthropic client we use (tests pass a fake). */
export type ClaudeClient = Pick<Anthropic, "beta">;

/**
 * Claude always thinks before answering (Opus 5.5 can't turn it off), and
 * thinking (plus the code it writes to filter search results) counts against
 * max_tokens: this much extra room keeps a full-length answer from being cut
 * off. Only what's used is billed.
 */
const CLAUDE_EXTRA_TOKENS = 6_144;

/**
 * Before its first word, give up on Claude (and fall back) if the stream goes
 * quiet this long. Every event (thinking, a search starting or finishing)
 * restarts the clock, so a long web search doesn't count as stuck.
 */
const CLAUDE_IDLE_MS = 25_000;

/**
 * Web tools Claude may use on its own: Anthropic runs them (no code on our
 * side). Searches are billed per search and fetched pages as input tokens, so
 * both are capped per message.
 */
export const WEB_TOOLS = [
  { type: "web_search_20260209", name: "web_search", max_uses: 3 },
  {
    type: "web_fetch_20260209",
    name: "web_fetch",
    max_uses: 3,
    // ~20k tokens per page (≈8¢ on Opus 5.5) is plenty for an article; huge pages are cut.
    max_content_tokens: 20_000,
    citations: { enabled: true },
  },
] satisfies Anthropic.Beta.BetaToolUnion[];

/** Server-side tool loops can pause (stop_reason "pause_turn"); resume at most this many times. */
const MAX_PAUSE_CONTINUATIONS = 2;

/**
 * A text block shorter than this is held back until we see what follows it:
 * if a tool call follows, it was a progress note ("Let me search…") and is
 * dropped; otherwise it's released. Longer blocks stream live.
 */
const HOLD_TEXT_CHARS = 240;

/** At most this many links under an answer. */
const MAX_SOURCES = 5;

/** Web tools turned off on the account (HTTP 400): answer without them until then. */
let webToolsOffUntil = 0;
const WEB_TOOLS_OFF_MS = 60 * 60 * 1000;

/**
 * Claude thinks first, so its first word takes longer than Flash-Lite's. Start
 * a backup only after this; at the default 3 s the free model would often win
 * and Claude (the paid default) would be sidelined as "slow".
 */
export const CLAUDE_HEDGE_AFTER_MS = 10_000;

/** The chain's @reasoning levels → Claude effort. Default medium; `@low` (or none/minimal) for faster, cheaper replies. */
export function claudeEffort(reasoning: Reasoning | undefined): ClaudeEffort {
  if (reasoning === undefined) return "medium";
  return reasoning === "medium" || reasoning === "high" ? reasoning : "low";
}

/** The account has web search / fetch turned off (Console → Privacy / feature settings). */
function isWebToolsError(err: unknown): boolean {
  return err instanceof Anthropic.BadRequestError && /web[_ ]?(search|fetch)/i.test(`${err.message} ${JSON.stringify(err.error ?? {})}`);
}

/** What a tool call is doing, for the status line. Code execution is how Claude filters search results. */
function toolStatus(name: string, input = ""): ReplyStatus {
  if (name === "web_fetch" || /\bweb_fetch\s*\(/.test(input)) return "reading";
  if (name === "web_search" || /\bweb_search\s*\(/.test(input)) return "searching";
  return "working";
}

/** "**Sources**" list in Markdown, or "" when there are none. */
export function formatSources(sources: Map<string, string>): string {
  const items = [...sources]
    .filter(([url]) => /^https?:\/\//i.test(url))
    .slice(0, MAX_SOURCES)
    .map(([url, title], i) => {
      let label = title.trim();
      if (!label) {
        try {
          label = new URL(url).hostname.replace(/^www\./, "");
        } catch {
          label = url;
        }
      }
      // Brackets would end the link text early; <…> keeps odd URLs intact.
      return `${i + 1}. [${label.replace(/[[\]]/g, "\\$&")}](<${url.replace(/[<>\s]/g, encodeURIComponent)}>)`;
    });
  return items.length ? `\n\n**Sources**\n${items.join("\n")}` : "";
}

/** When Claude filters search results in code it cites nothing: list this many top results instead. */
const MAX_UNCITED_RESULTS = 3;

/**
 * Pages Claude cited from search results or opened with web_fetch (url → title)
 * go in `sources`; every search result goes in `searched`, as a fallback.
 */
function collectSources(
  content: Anthropic.Beta.BetaContentBlock[],
  { sources, searched }: { sources: Map<string, string>; searched: Map<string, string> },
): void {
  for (const block of content) {
    if (block.type === "text") {
      for (const c of block.citations ?? []) {
        if (c.type === "web_search_result_location" && !sources.has(c.url)) sources.set(c.url, c.title ?? "");
      }
    } else if (block.type === "web_fetch_tool_result" && block.content.type === "web_fetch_result") {
      const { url, content: doc } = block.content;
      if (!sources.has(url)) sources.set(url, doc.title ?? "");
    } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const result of block.content) {
        if (!searched.has(result.url)) searched.set(result.url, result.title ?? "");
      }
    }
  }
}

/** Cited / opened pages, or else the top search results. */
function sourcesToList({ sources, searched }: { sources: Map<string, string>; searched: Map<string, string> }): Map<string, string> {
  return sources.size ? sources : new Map([...searched].slice(0, MAX_UNCITED_RESULTS));
}

/**
 * Streams from Claude, with web search and page reading. Like aiSdkProvider:
 * errors are thrown (so the chain falls back) and the user's Stop ends the
 * stream quietly. While Claude searches or reads, it yields status updates;
 * a refusal before any text is thrown so another model gets a go. Cited and
 * opened pages are listed under the answer.
 */
export function anthropicProvider(name: string, model: string, effort: ClaudeEffort, client: ClaudeClient): LlmProvider {
  async function* run(
    messages: LlmMessage[],
    { system, maxTokens, onUsage, abortSignal }: StreamOptions,
    useWeb: boolean,
  ): AsyncGenerator<LlmChunk> {
    const idle = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const armIdleTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => idle.abort(new DOMException(`no reply after ${CLAUDE_IDLE_MS / 1000}s of silence`, "TimeoutError")),
        CLAUDE_IDLE_MS,
      );
    };
    armIdleTimer();
    const signal = abortSignal ? AbortSignal.any([abortSignal, idle.signal]) : idle.signal;

    let conversation = messages.map(toClaudeMessage);
    const usage: Required<LlmUsage> = { inputTokens: 0, outputTokens: 0, webSearches: 0, webFetches: 0 };
    const found = { sources: new Map<string, string>(), searched: new Map<string, string>() };
    let stream: ReturnType<ClaudeClient["beta"]["messages"]["stream"]> | undefined;
    let finished = false;
    let sentText = false;
    // A short text block not yet released (see HOLD_TEXT_CHARS).
    let held = "";
    let holding = false;
    // The server tool call being streamed: its name and input so far.
    let tool: { name: string; input: string } | null = null;

    try {
      for (let turn = 0; ; turn++) {
        stream = client.beta.messages.stream(
          {
            model,
            system: `${system}\n\n${useWeb ? WEB_ACCESS_PROMPT : NO_WEB_ACCESS_PROMPT}`,
            messages: conversation,
            max_tokens: maxTokens + CLAUDE_EXTRA_TOKENS,
            output_config: { effort },
            ...(useWeb ? { tools: WEB_TOOLS } : {}),
            // Caches tools + system prompt + history, so follow-ups (and the ~7k tokens of web tool setup) cost less.
            cache_control: { type: "ephemeral" },
            // If Claude declines on safety grounds, Anthropic retries on another Claude model in the same call.
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          },
          { signal },
        );

        for await (const event of stream) {
          if (!sentText) armIdleTimer();
          if (event.type === "content_block_start") {
            const block = event.content_block;
            if (block.type === "server_tool_use") {
              // Text right before a tool call was a progress note, not the answer.
              held = "";
              holding = false;
              tool = { name: block.name, input: "" };
              yield { status: toolStatus(block.name) };
              continue;
            }
            if (held) {
              sentText = true;
              yield held;
              held = "";
            }
            holding = block.type === "text";
          } else if (event.type === "content_block_delta") {
            if (event.delta.type === "input_json_delta" && tool) {
              tool.input += event.delta.partial_json;
            } else if (event.delta.type === "text_delta" && event.delta.text) {
              if (!holding) {
                sentText = true;
                yield event.delta.text;
              } else {
                held += event.delta.text;
                if (held.length >= HOLD_TEXT_CHARS) {
                  sentText = true;
                  yield held;
                  held = "";
                  holding = false;
                }
              }
            }
          } else if (event.type === "content_block_stop" && tool) {
            // Now we know what the code-execution step runs (a search or a page fetch).
            if (tool.name !== "web_search" && tool.name !== "web_fetch") {
              const status = toolStatus(tool.name, tool.input);
              if (status !== "working") yield { status };
            }
            tool = null;
          }
        }

        const final = await stream.finalMessage();
        const u = final.usage;
        usage.inputTokens += u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        usage.outputTokens += u.output_tokens;
        usage.webSearches += u.server_tool_use?.web_search_requests ?? 0;
        usage.webFetches += u.server_tool_use?.web_fetch_requests ?? 0;
        collectSources(final.content, found);

        // The server's tool loop paused: send its work back and it carries on.
        if (final.stop_reason === "pause_turn" && turn < MAX_PAUSE_CONTINUATIONS) {
          conversation = [...conversation, { role: "assistant", content: final.content as Anthropic.Beta.BetaContentBlockParam[] }];
          continue;
        }
        finished = true;
        if (final.stop_reason === "refusal" && !sentText && !held) {
          throw new Error(`Claude declined to answer (${final.stop_details?.category ?? "no category"})`);
        }
        break;
      }

      if (held) {
        sentText = true;
        yield held;
      }
      if (sentText && !abortSignal?.aborted) {
        const list = formatSources(sourcesToList(found));
        if (list) yield list;
      }
      onUsage?.(usage);
    } catch (err) {
      // Stopped by the user (or the chain stopping a loser): end quietly, like AI SDK streams do.
      if (abortSignal?.aborted) return;
      // Our silence timeout: report it as a timeout so the model is skipped for a while.
      if (idle.signal.aborted) throw idle.signal.reason;
      // Web tools turned off on the account: answer without them (and stop asking for a while).
      if (useWeb && !sentText && isWebToolsError(err)) {
        webToolsOffUntil = Date.now() + WEB_TOOLS_OFF_MS;
        console.warn(`Claude web tools unavailable (${describeError(err)}); answering without them for an hour`);
        clearTimeout(timer);
        yield* run(messages, { system, maxTokens, onUsage, abortSignal }, false);
        return;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      // The reader stopped early: end the request too.
      if (!finished) stream?.abort();
    }
  }

  return {
    name,
    supportsImages: true,
    hedgeAfterMs: CLAUDE_HEDGE_AFTER_MS,
    stream: (messages, opts) => run(messages, opts, Date.now() >= webToolsOffUntil),
  };
}

type ClaudeImageType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/** Same shape as toModelMessage: attachments first, PDFs as documents, other files as text. */
export function toClaudeMessage(m: LlmMessage): Anthropic.Beta.BetaMessageParam {
  if (m.role === "assistant") return { role: "assistant", content: m.content };
  const doc = m.document;
  if (doc && !doc.pdf) {
    return { role: "user", content: `${m.content}\n\n${documentAsText(doc.name, doc.text)}` };
  }
  if (doc?.pdf) {
    return {
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.pdf } },
        { type: "text", text: `${m.content}\n\n[Attached file: ${doc.name}]` },
      ],
    };
  }
  if (!m.image) return { role: "user", content: m.content };
  return {
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: m.image.mediaType as ClaudeImageType, data: m.image.data } },
      { type: "text", text: m.content },
    ],
  };
}

const mockProvider: LlmProvider = {
  name: "mock",
  supportsImages: true,
  async *stream(messages, { abortSignal }) {
    const last = messages.at(-1);
    // A link or "search" in the message: pretend to read / search first, so the status UI can be checked.
    const web = /https?:\/\//i.test(last?.content ?? "") ? "reading" : /\bsearch\b/i.test(last?.content ?? "") ? "searching" : null;
    if (web) {
      yield { status: web };
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      if (abortSignal?.aborted) return;
    }
    // Names every document the model would see (this message or earlier ones), so tests can check follow-ups.
    const documents = messages.flatMap((m) =>
      m.document ? [m.document.name] : [...m.content.matchAll(/\[Attached file: ([^\]]+)\]/g)].map((x) => x[1]),
    );
    yield* mockReply(last?.content ?? "", { image: !!last?.image, documents, signal: abortSignal });
  },
};

// ---- the model chain ----

/**
 * Models to try, fastest first. Free limits are per model, so the chain adds
 * them up: a model that runs out is skipped until it resets. Each entry is
 * `provider:model`, optionally `@reasoning` (thinking effort). Override with
 * LLM_CHAIN in the environment.
 *
 * Claude Opus 5.5 (paid, ANTHROPIC_API_KEY) answers first. The free models
 * behind it only answer when Claude fails, is rate-limited or out of credit,
 * ordered by time to first word (measured Oct 2026): 3.5 Flash-Lite ~1 s with
 * 500 free requests/day; 3.6 Flash (~6 s) and 3.8 Flash (often no reply within
 * 40 s) are late backups.
 */
export const DEFAULT_CHAIN =
  "claude:claude-opus-5-5, " +
  "gemini:gemini-3.5-flash-lite, gemini:gemini-2.5-flash, gemini:gemini-3.1-flash-lite, " +
  "groq:openai/gpt-oss-120b, gemini:gemini-3.6-flash, gemini:gemini-3.8-flash@low, " +
  "groq:qwen/qwen3.8-27b, groq:openai/gpt-oss-20b";

const REASONING_LEVELS = new Set(["none", "minimal", "low", "medium", "high"]);

export interface ModelSpec {
  provider: "claude" | "gemini" | "groq";
  model: string;
  reasoning?: Reasoning;
}

/** "gemini:gemini-3.8-flash@low, groq:openai/gpt-oss-120b" → specs; bad entries are skipped with a warning. */
export function parseChain(spec: string): ModelSpec[] {
  return spec
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const match = /^(claude|gemini|groq):([^@\s]+)(?:@(\w+))?$/.exec(entry);
      if (!match || (match[3] && !REASONING_LEVELS.has(match[3]))) {
        console.warn(`LLM_CHAIN: ignoring "${entry}" (expected provider:model or provider:model@reasoning)`);
        return [];
      }
      const [, provider, model, reasoning] = match;
      return [{ provider: provider as ModelSpec["provider"], model, reasoning: reasoning as Reasoning | undefined }];
    });
}

let claudeClient: Anthropic | undefined;

function buildProvider(spec: ModelSpec): LlmProvider | null {
  const name = `${spec.provider}:${spec.model}`;
  if (spec.provider === "claude") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    // No retries: a failing model falls back to the next one instead. 240 s allows for web searches
    // and whole documents, and still leaves the route (maxDuration 300 s) time to fall back.
    claudeClient ??= new Anthropic({ apiKey, maxRetries: 0, timeout: 240_000 });
    return anthropicProvider(name, spec.model, claudeEffort(spec.reasoning), claudeClient);
  }
  if (spec.provider === "gemini") {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) return null;
    // Minimal thinking by default: thinking tokens count against maxOutputTokens.
    // Gemini models read photos and PDFs; Gemma (also served by this API) doesn't.
    return aiSdkProvider(
      name,
      createGoogleGenerativeAI({ apiKey })(spec.model),
      { reasoning: spec.reasoning ?? "minimal" },
      spec.model.startsWith("gemini-"),
    );
  }
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  // gpt-oss / qwen reason before answering; low effort keeps it inside maxOutputTokens.
  return aiSdkProvider(name, createGroq({ apiKey })(spec.model), { reasoning: spec.reasoning ?? "low" });
}

let warnedLegacy = false;

/**
 * The models to try for a request, in order: LLM_CHAIN or DEFAULT_CHAIN (just
 * its Groq part with LLM_PROVIDER=groq), or the mock with LLM_PROVIDER=mock.
 * Models whose API key isn't set are left out.
 */
export function providerChain(): LlmProvider[] {
  const choice = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
  if (choice === "mock") return [mockProvider];

  if (!process.env.LLM_CHAIN && (process.env.LLM_MODEL || process.env.GROQ_MODEL) && !warnedLegacy) {
    warnedLegacy = true;
    console.warn("LLM_MODEL / GROQ_MODEL are no longer used: the default model chain applies (set LLM_CHAIN to change it).");
  }
  let specs = parseChain(process.env.LLM_CHAIN || DEFAULT_CHAIN);
  if (choice === "groq") specs = specs.filter((s) => s.provider === "groq");

  const chain = specs.map(buildProvider).filter((p): p is LlmProvider => p !== null);
  if (chain.length === 0) {
    console.error(
      "No AI model is usable: set ANTHROPIC_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY / GROQ_API_KEY (or LLM_PROVIDER=mock to test without one)",
    );
    throw new HttpError(503, "The chat isn't configured yet: no AI provider key is set.");
  }
  return chain;
}

// ---- rate limits: leave a model that's out of quota alone until it resets ----

/** Model name → time (ms since epoch) until which it's skipped. Per server instance, which is plenty. */
const cooldowns = new Map<string, number>();

const MIN_COOLDOWN_MS = 5_000;
const MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** "14h1m21.17s", "7m12s", "45.5s" → ms. */
function parseDuration(text: string | undefined): number | null {
  const match = text ? /^(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?$/.exec(text) : null;
  if (!match || !match[0]) return null;
  const [, h = "0", m = "0", s = "0"] = match;
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000;
}

/**
 * For a rate-limit error (HTTP 429), how long to leave that model alone: the
 * provider's own hint (Gemini's RetryInfo "retryDelay", Groq's "try again in…",
 * a Retry-After header), else an hour for daily limits and a minute otherwise.
 * Null for any other error.
 */
export function rateLimitCooldownMs(err: unknown): number | null {
  const http = httpErrorInfo(err);
  if (http?.status !== 429) return null;
  const { body } = http;
  const retryDelay = /"retryDelay":\s*"([\d.]+)s"/.exec(body)?.[1];
  const retryAfter = Number(http.retryAfter);
  const hint =
    (retryDelay ? Number(retryDelay) * 1000 : null) ??
    parseDuration(/(?:try again|retry) in ([\dhms.]+?)\.?(?:\s|$)/i.exec(body)?.[1]) ??
    (retryAfter > 0 ? retryAfter * 1000 : null);
  const fallback = /PerDay|per day|\bRPD\b|\bTPD\b|daily/i.test(body) ? 60 * 60 * 1000 : 60_000;
  return Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, hint ?? fallback));
}

/** Status, body text and Retry-After of an HTTP error from the AI SDK or the Anthropic SDK; null otherwise. */
function httpErrorInfo(err: unknown): { status: number | undefined; body: string; retryAfter: string | null | undefined } | null {
  if (APICallError.isInstance(err)) {
    return { status: err.statusCode, body: `${err.responseBody ?? ""}\n${err.message}`, retryAfter: err.responseHeaders?.["retry-after"] };
  }
  if (err instanceof Anthropic.APIError) {
    return { status: err.status, body: `${JSON.stringify(err.error ?? {})}\n${err.message}`, retryAfter: err.headers?.get("retry-after") };
  }
  return null;
}

/** Outages and timeouts: skip the model briefly so every request doesn't wait on it. */
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

/** Bad API key or no credit left: nothing will change soon, so stop trying for a while. */
const ACCOUNT_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * How long to skip a model after it failed before its first word: the rate
 * limit wait for a 429, an hour for a bad key or an account out of credit, a
 * few minutes for a timeout / 5xx (incl. Anthropic's 529 "overloaded") /
 * network error, and not at all for other 4xx (those are about this request,
 * not the model).
 */
export function failureCooldownMs(err: unknown): number | null {
  const rateLimit = rateLimitCooldownMs(err);
  if (rateLimit !== null) return rateLimit;
  const http = httpErrorInfo(err);
  if (http?.status === 401 || http?.status === 403) return ACCOUNT_COOLDOWN_MS;
  if (http?.status === 400 && /credit balance/i.test(http.body)) return ACCOUNT_COOLDOWN_MS;
  if (http?.status !== undefined && http.status < 500) return null;
  return FAILURE_COOLDOWN_MS;
}

/** Tests only. */
export function resetCooldowns(): void {
  cooldowns.clear();
  webToolsOffUntil = 0;
}

function formatWait(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return minutes >= 1 ? `${minutes}m` : `${Math.round(ms / 1000)}s`;
}

/** One-line summary; AI SDK errors carry full request/response dumps. */
function describeError(err: unknown): string {
  if (APICallError.isInstance(err)) return `HTTP ${err.statusCode ?? "?"}: ${err.message.split("\n")[0]}`;
  if (err instanceof Anthropic.APIError) return `HTTP ${err.status ?? "?"}: ${err.message.split("\n")[0]}`;
  return err instanceof Error ? err.message : String(err);
}

/**
 * No first word from a model after this long: also start the next one and use
 * whichever answers first. Free models are sometimes slow for a while (Oct 2026:
 * 3.5 Flash-Lite took 17-24 s while 2.5 Flash took ~1 s), and a fresh server
 * instance doesn't know which ones are, so waiting for the timeout made the
 * first message after a break slow.
 */
export const HEDGE_AFTER_MS = 3_000;

interface Attempt {
  provider: LlmProvider;
  startedAt: number;
  controller: AbortController;
  iterator: AsyncIterator<LlmChunk>;
  /** The attempt's next chunk (or end, or error) while no model has answered yet. */
  first: Promise<Outcome>;
  /** Sent a status (e.g. searching the web): busy, not stuck, so don't hedge it or count it as slow. */
  busy: boolean;
}

type Outcome = { attempt: Attempt; ok: true; result: IteratorResult<LlmChunk> } | { attempt: Attempt; ok: false; error: unknown };

function nextOutcome(attempt: Attempt): Promise<Outcome> {
  return attempt.iterator.next().then(
    (result): Outcome => ({ attempt, ok: true, result }),
    (error: unknown): Outcome => ({ attempt, ok: false, error }),
  );
}

/**
 * Streams from the first available model in the chain. If a model fails
 * before producing any text (rate limit, outage, timeout), the next one is
 * tried, and the failed one is skipped for later requests for a while (a
 * rate-limited one until it resets). If it's just slow (no text after
 * HEDGE_AFTER_MS), the next one is started alongside it; the first to answer
 * wins, the other is stopped, and a slow loser is skipped for a while too.
 * A model that reports a status (searching the web, reading a page) is busy,
 * not slow: it isn't hedged, and its statuses are passed on for the UI.
 * Once text has been sent, an error is final.
 */
export async function* streamWithFallback(
  chain: LlmProvider[],
  messages: LlmMessage[],
  opts: StreamOptions,
): AsyncIterable<LlmChunk> {
  const now = Date.now();
  const ready = chain.filter((p) => (cooldowns.get(p.name) ?? 0) <= now);
  // Everything cooling down: try them all anyway (a limit may have reset early).
  const order = ready.length ? ready : chain;

  const running: Attempt[] = [];
  let next = 0;
  let winner: Attempt | undefined;
  let hedgeTimer: ReturnType<typeof setTimeout> | undefined;

  const start = () => {
    const provider = order[next++];
    const controller = new AbortController();
    // The user's Stop ends every attempt; our own controller ends just this one.
    const abortSignal = opts.abortSignal ? AbortSignal.any([opts.abortSignal, controller.signal]) : controller.signal;
    const iterator = provider.stream(messages, { ...opts, abortSignal })[Symbol.asyncIterator]();
    const attempt = { provider, startedAt: Date.now(), controller, iterator, busy: false } as Attempt;
    attempt.first = nextOutcome(attempt);
    running.push(attempt);
  };
  let lastStatus: ReplyStatus | undefined;

  try {
    start();
    while (!winner) {
      const newest = running.at(-1);
      const hedgeMs = newest?.provider.hedgeAfterMs ?? HEDGE_AFTER_MS;
      const hedge =
        newest && !newest.busy && next < order.length
          ? new Promise<"hedge">((resolve) => {
              hedgeTimer = setTimeout(() => resolve("hedge"), Math.max(0, newest.startedAt + hedgeMs - Date.now()));
            })
          : null;
      const outcome = await Promise.race([...running.map((a) => a.first), ...(hedge ? [hedge] : [])]);
      clearTimeout(hedgeTimer);

      if (outcome === "hedge") {
        console.warn(`LLM "${newest?.provider.name}" has no reply after ${hedgeMs / 1000}s; also trying "${order[next].name}"`);
        start();
        continue;
      }

      const { attempt } = outcome;
      const index = running.indexOf(attempt);
      running.splice(index, 1);

      // A status before any text: pass it on and keep waiting for this model's answer.
      if (outcome.ok && !outcome.result.done && typeof outcome.result.value !== "string") {
        attempt.busy = true;
        attempt.first = nextOutcome(attempt);
        running.splice(index, 0, attempt);
        const { status } = outcome.result.value;
        if (status !== lastStatus) {
          lastStatus = status;
          yield outcome.result.value;
        }
        continue;
      }

      if (!outcome.ok) {
        // Stopped by the user: not the model's fault, so no cooldown either.
        if (opts.abortSignal?.aborted) throw outcome.error;
        const wait = failureCooldownMs(outcome.error);
        if (wait !== null) cooldowns.set(attempt.provider.name, Date.now() + wait);
        // Out of models: give up.
        if (running.length === 0 && next >= order.length) throw outcome.error;
        console.warn(
          `LLM "${attempt.provider.name}" failed (${describeError(outcome.error)})` +
            `${wait !== null ? `; skipping it for ${formatWait(wait)}` : ""}` +
            `${running.length ? "; waiting for the other model" : `; trying "${order[next].name}"`}`,
        );
        if (running.length === 0) start();
        continue;
      }

      winner = attempt;
      // Ended without text: the user's Stop (AI SDK streams end quietly on abort) or an empty reply.
      const answered = !outcome.result.done && !opts.abortSignal?.aborted;
      for (const other of running) {
        // Started before the winner, so it had its head start and lost: skip it for a while
        // (unless it was busy searching: that's slow for a reason).
        if (answered && !other.busy && other.startedAt < attempt.startedAt) cooldowns.set(other.provider.name, Date.now() + FAILURE_COOLDOWN_MS);
        other.controller.abort();
        other.iterator.return?.().catch(() => {});
      }
      running.length = 0;

      if (outcome.result.done) return;
      cooldowns.delete(attempt.provider.name);
      opts.onModel?.(attempt.provider.name);
      yield outcome.result.value;
    }

    try {
      for (;;) {
        const { done, value } = await winner.iterator.next();
        if (done) return;
        yield value;
      }
    } catch (err) {
      // Mid-reply errors are final; only a rate limit sidelines the model.
      if (!opts.abortSignal?.aborted) {
        const wait = rateLimitCooldownMs(err);
        if (wait !== null) cooldowns.set(winner.provider.name, Date.now() + wait);
      }
      throw err;
    }
  } finally {
    clearTimeout(hedgeTimer);
    // Error or the reader stopped early: end whatever is still running.
    for (const other of running) {
      other.controller.abort();
      other.iterator.return?.().catch(() => {});
    }
    winner?.iterator.return?.().catch(() => {});
  }
}
