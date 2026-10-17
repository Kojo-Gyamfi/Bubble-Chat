import "server-only";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { APICallError, type LanguageModel, type ModelMessage, streamText } from "ai";
import { HttpError } from "@/lib/auth";
import { documentAsText } from "@/lib/chat/documents";
import { mockReply } from "@/lib/chat/mock";

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
}

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
  /** Can read images and PDFs (Gemini). Photo messages skip providers that can't. */
  supportsImages: boolean;
  stream(messages: LlmMessage[], opts: StreamOptions): AsyncIterable<string>;
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
        instructions: system,
        messages: messages.map((m) => toModelMessage(m, supportsImages)),
        abortSignal,
        maxOutputTokens: maxTokens,
        // Fall back to the next model instead of retrying a rate-limited one.
        maxRetries: 0,
        // Stay well inside the route's 60 s maxDuration.
        timeout: { firstChunkMs: 15_000, totalMs: 50_000 },
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
      { type: "image", image: m.image.data, mediaType: m.image.mediaType },
      { type: "text", text: m.content },
    ],
  };
}

const mockProvider: LlmProvider = {
  name: "mock",
  supportsImages: true,
  stream: (messages, { abortSignal }) => {
    const last = messages.at(-1);
    // Names every document the model would see (this message or earlier ones), so tests can check follow-ups.
    const documents = messages.flatMap((m) =>
      m.document ? [m.document.name] : [...m.content.matchAll(/\[Attached file: ([^\]]+)\]/g)].map((x) => x[1]),
    );
    return mockReply(last?.content ?? "", { image: !!last?.image, documents, signal: abortSignal });
  },
};

// ---- the model chain ----

/**
 * Models to try, best first. Free limits are per model, so the chain adds
 * them up: a model that runs out is skipped until it resets. Each entry is
 * `provider:model`, optionally `@reasoning` (thinking effort). Override with
 * LLM_CHAIN in the environment.
 */
export const DEFAULT_CHAIN =
  "gemini:gemini-3.8-flash@low, gemini:gemini-3.6-flash, gemini:gemini-2.5-flash, " +
  "gemini:gemini-3.5-flash-lite, gemini:gemini-3.1-flash-lite, " +
  "groq:openai/gpt-oss-120b, groq:qwen/qwen3.8-27b, groq:openai/gpt-oss-20b";

const REASONING_LEVELS = new Set(["none", "minimal", "low", "medium", "high"]);

export interface ModelSpec {
  provider: "gemini" | "groq";
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
      const match = /^(gemini|groq):([^@\s]+)(?:@(\w+))?$/.exec(entry);
      if (!match || (match[3] && !REASONING_LEVELS.has(match[3]))) {
        console.warn(`LLM_CHAIN: ignoring "${entry}" (expected provider:model or provider:model@reasoning)`);
        return [];
      }
      const [, provider, model, reasoning] = match;
      return [{ provider: provider as ModelSpec["provider"], model, reasoning: reasoning as Reasoning | undefined }];
    });
}

function buildProvider(spec: ModelSpec): LlmProvider | null {
  const name = `${spec.provider}:${spec.model}`;
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
    console.error("No AI model is usable: set GOOGLE_GENERATIVE_AI_API_KEY / GROQ_API_KEY (or LLM_PROVIDER=mock to test without one)");
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
  if (!APICallError.isInstance(err) || err.statusCode !== 429) return null;
  const body = `${err.responseBody ?? ""}\n${err.message}`;
  const retryDelay = /"retryDelay":\s*"([\d.]+)s"/.exec(body)?.[1];
  const retryAfter = Number(err.responseHeaders?.["retry-after"]);
  const hint =
    (retryDelay ? Number(retryDelay) * 1000 : null) ??
    parseDuration(/(?:try again|retry) in ([\dhms.]+?)\.?(?:\s|$)/i.exec(body)?.[1]) ??
    (retryAfter > 0 ? retryAfter * 1000 : null);
  const fallback = /PerDay|per day|\bRPD\b|\bTPD\b|daily/i.test(body) ? 60 * 60 * 1000 : 60_000;
  return Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, hint ?? fallback));
}

/** Tests only. */
export function resetCooldowns(): void {
  cooldowns.clear();
}

function formatWait(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return minutes >= 1 ? `${minutes}m` : `${Math.round(ms / 1000)}s`;
}

/** One-line summary; AI SDK errors carry full request/response dumps. */
function describeError(err: unknown): string {
  if (APICallError.isInstance(err)) return `HTTP ${err.statusCode ?? "?"}: ${err.message.split("\n")[0]}`;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Streams from the first available model in the chain. If a model fails
 * before producing any text (rate limit, outage, timeout), the next one is
 * tried; a rate-limited model is also skipped for later requests until it
 * resets. Once text has been sent, an error is final.
 */
export async function* streamWithFallback(
  chain: LlmProvider[],
  messages: LlmMessage[],
  opts: StreamOptions,
): AsyncIterable<string> {
  const now = Date.now();
  const ready = chain.filter((p) => (cooldowns.get(p.name) ?? 0) <= now);
  // Everything cooling down: try them all anyway (a limit may have reset early).
  const order = ready.length ? ready : chain;

  for (const [i, provider] of order.entries()) {
    let started = false;
    try {
      for await (const chunk of provider.stream(messages, opts)) {
        if (!started) {
          started = true;
          cooldowns.delete(provider.name);
          opts.onModel?.(provider.name);
        }
        yield chunk;
      }
      return;
    } catch (err) {
      const wait = rateLimitCooldownMs(err);
      if (wait !== null) cooldowns.set(provider.name, Date.now() + wait);
      // Stopped by the user, already mid-reply, or out of models: don't try another.
      if (opts.abortSignal?.aborted || started || i === order.length - 1) throw err;
      console.warn(
        `LLM "${provider.name}" failed (${describeError(err)})` +
          `${wait !== null ? `; skipping it for ${formatWait(wait)}` : ""}; trying "${order[i + 1].name}"`,
      );
    }
  }
}
