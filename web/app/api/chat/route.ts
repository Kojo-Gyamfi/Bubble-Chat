import { after } from "next/server";
import { errorResponse, requireUser } from "@/lib/auth";
import { chatRequestSchema } from "@/lib/chat/schema";
import { appendAssistantMessage, appendUserMessage, loadHistory } from "@/lib/chat/store";
import { streamAndPersist } from "@/lib/chat/stream";
import { type LlmUsage, providerChain, streamWithFallback } from "@/lib/llm";
import { buildMessages, MAX_CONTEXT_MESSAGES, MAX_OUTPUT_TOKENS, systemPrompt } from "@/lib/prompt";
import { consumeRequest, dayKey, limitMessage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);

    const parsed = chatRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    const { conversationId, userMessageId, assistantMessageId, message } = parsed.data;

    // Before counting usage, so a misconfigured provider doesn't burn quota.
    const chain = providerChain();

    // Count usage and read history in parallel (the new message is excluded
    // from history and appended in memory).
    const day = dayKey();
    const [limit, history] = await Promise.all([
      consumeRequest(user.uid, day),
      loadHistory(user.uid, conversationId, MAX_CONTEXT_MESSAGES, userMessageId),
    ]);
    if (!limit.ok) {
      return Response.json({ error: limitMessage(limit) }, { status: 429 });
    }

    // Save the user's message while the model starts on the reply; the reply
    // is only saved after the user's message has been.
    const userSaved = appendUserMessage(user, conversationId, userMessageId, message);
    // after(): finish the save even if we return early (e.g. 503 when every model fails).
    after(userSaved.catch((err) => console.error("Failed to save user message", err)));

    let usage: LlmUsage | undefined;
    const reply = streamWithFallback(chain, buildMessages(history, message), {
      system: systemPrompt(),
      maxTokens: MAX_OUTPUT_TOKENS,
      onUsage: (u) => (usage = u),
    });

    return await streamAndPersist(reply, async (text) => {
      await userSaved;
      await appendAssistantMessage(user.uid, conversationId, assistantMessageId, text, usage && { day, tokens: usage });
    });
  } catch (err) {
    return errorResponse(err);
  }
}
