import "server-only";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { APICallError, type LanguageModel, streamText } from "ai";
import { HttpError } from "@/lib/auth";
import { mockReply } from "@/lib/chat/mock";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StreamOptions {
  system: string;
  maxTokens: number;
  onUsage?: (usage: LlmUsage) => void;
}

export interface LlmProvider {
  name: string;
  stream(messages: LlmMessage[], opts: StreamOptions): AsyncIterable<string>;
}

const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

/** Wraps an AI SDK model. Provider errors (e.g. 429) are thrown, not swallowed. */
export function aiSdkProvider(
  name: string,
  model: LanguageModel,
  extra: { reasoning?: Parameters<typeof streamText>[0]["reasoning"] } = {},
): LlmProvider {
  return {
    name,
    async *stream(messages, { system, maxTokens, onUsage }) {
      const result = streamText({
        model,
        instructions: system,
        messages,
        maxOutputTokens: maxTokens,
        // Fall back to the next provider instead of retrying a rate-limited one.
        maxRetries: 0,
        // Stay well inside the route's 60 s maxDuration.
        timeout: { firstChunkMs: 15_000, totalMs: 50_000 },
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

const mockProvider: LlmProvider = {
  name: "mock",
  stream: (messages) => mockReply(messages.at(-1)?.content ?? ""),
};

function geminiProvider(): LlmProvider | null {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return null;
  const google = createGoogleGenerativeAI({ apiKey });
  // Minimal thinking: thinking tokens count against maxOutputTokens.
  return aiSdkProvider("gemini", google(process.env.LLM_MODEL || DEFAULT_GEMINI_MODEL), {
    reasoning: "minimal",
  });
}

function groqProvider(): LlmProvider | null {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  const groq = createGroq({ apiKey });
  // gpt-oss reasons before answering; low effort keeps it inside maxOutputTokens.
  // Models without reasoning ignore this (the SDK logs a warning).
  return aiSdkProvider("groq", groq(process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL), {
    reasoning: "low",
  });
}

/** Provider order from LLM_PROVIDER: gemini (→ groq fallback), groq, or mock. */
export function providerChain(): LlmProvider[] {
  const choice = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
  if (choice === "mock") return [mockProvider];

  const chain = (choice === "groq" ? [groqProvider()] : [geminiProvider(), groqProvider()]).filter(
    (p): p is LlmProvider => p !== null,
  );
  if (chain.length === 0) {
    console.error(`LLM_PROVIDER=${choice} but no API key is set for it (set LLM_PROVIDER=mock to test without one)`);
    throw new HttpError(503, "The chat isn't configured yet: no AI provider key is set.");
  }
  return chain;
}

/** One-line summary; AI SDK errors carry full request/response dumps. */
function describeError(err: unknown): string {
  if (APICallError.isInstance(err)) return `HTTP ${err.statusCode ?? "?"}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Streams from the first provider in the chain. If a provider fails before
 * producing any text (rate limit, outage, timeout), the next one is tried;
 * once text has been sent, an error is final.
 */
export async function* streamWithFallback(
  chain: LlmProvider[],
  messages: LlmMessage[],
  opts: StreamOptions,
): AsyncIterable<string> {
  for (const [i, provider] of chain.entries()) {
    let started = false;
    try {
      for await (const chunk of provider.stream(messages, opts)) {
        started = true;
        yield chunk;
      }
      return;
    } catch (err) {
      if (started || i === chain.length - 1) throw err;
      console.warn(`LLM provider "${provider.name}" failed (${describeError(err)}); falling back to "${chain[i + 1].name}"`);
    }
  }
}
