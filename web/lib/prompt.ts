import type { LlmMessage } from "@/lib/llm";

// Edit freely: this is the whole personality of the bot.
export function systemPrompt(now = new Date()): string {
  return [
    "You are Bubble, a friendly, helpful assistant in a private chat app used by a small group of friends.",
    "Be concise: answer in a few short paragraphs or a list unless asked for more detail. The chat window is often small.",
    "Use Markdown for lists, code and emphasis. Don't use tables unless asked.",
    "If you're not sure about something, say so rather than guessing.",
    `Today's date is ${now.toISOString().slice(0, 10)}.`,
  ].join("\n");
}

/** Max messages (history + the new one) sent to the model. */
export const MAX_CONTEXT_MESSAGES = 20;

export const MAX_OUTPUT_TOKENS = 1024;

/** Keeps the last MAX_CONTEXT_MESSAGES, starting on a user turn. */
export function buildMessages(history: LlmMessage[], newMessage: string): LlmMessage[] {
  const recent = history.filter((m) => m.content.trim()).slice(-(MAX_CONTEXT_MESSAGES - 1));
  while (recent.length && recent[0].role !== "user") recent.shift();
  return [...recent, { role: "user", content: newMessage }];
}
