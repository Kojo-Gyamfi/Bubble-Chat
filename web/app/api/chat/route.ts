import { after } from "next/server";
import { errorResponse, requireUser } from "@/lib/auth";
import { readDocument } from "@/lib/chat/documents";
import { chatRequestSchema } from "@/lib/chat/schema";
import { appendAssistantMessage, appendUserMessage, loadHistory } from "@/lib/chat/store";
import { streamAndPersist } from "@/lib/chat/stream";
import { renderFile } from "@/lib/files/render";
import { saveFile } from "@/lib/files/store";
import { withFiles } from "@/lib/files/stream";
import { type LlmUsage, providerChain, streamWithFallback } from "@/lib/llm";
import {
  asksForFile,
  buildMessages,
  MAX_CONTEXT_MESSAGES,
  MAX_FILE_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  systemPrompt,
} from "@/lib/prompt";
import { consumeRequest, dayKey, limitMessage } from "@/lib/usage";

export const runtime = "nodejs";
// A reply that searches the web or writes a whole document can take 20-120 s
// (Claude's own timeout is 240 s). 300 s is the Vercel Hobby maximum.
export const maxDuration = 300;

const NO_IMAGE_MODEL =
  "Photo and scanned-document questions are unavailable right now (the AI that reads them is busy). Try again later, or ask in text.";

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);

    const parsed = chatRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: "That message couldn't be sent. Please try again." }, { status: 400 });
    }
    const { conversationId, userMessageId, assistantMessageId, message, image, file } = parsed.data;

    // Read an attached document first: a bad file fails fast without using quota.
    const document = file ? await readDocument(file) : undefined;

    // Before counting usage, so a misconfigured provider doesn't burn quota.
    // Photos (and scanned PDFs with no text) can only go to models that read images
    // (Gemini, not the Groq fallback); other documents also work as plain text.
    const needsVision = !!image || (!!document?.pdf && !document.text);
    const chain = providerChain().filter((p) => !needsVision || p.supportsImages);
    if (chain.length === 0) return Response.json({ error: NO_IMAGE_MODEL }, { status: 503 });

    // Count usage and read history in parallel (the new message is excluded
    // from history and appended in memory).
    const day = dayKey();
    const [limit, history] = await Promise.all([
      consumeRequest(user.uid, day),
      loadHistory(user.uid, conversationId, MAX_CONTEXT_MESSAGES, userMessageId),
    ]);
    if (!limit.ok) {
      return Response.json({ error: limitMessage(limit) }, { status: 429, headers: { "X-Messages-Left": "0" } });
    }

    // Save the user's message while the model starts on the reply; the reply
    // is only saved after the user's message has been.
    const userSaved = appendUserMessage(user, conversationId, userMessageId, message, {
      image: image?.thumbnail,
      document,
    });
    // after(): finish the save even if we return early (e.g. 503 when every model fails).
    after(userSaved.catch((err) => console.error("Failed to save user message", err)));

    // Stop button / closed page: end the model call and save what we have.
    const stop = new AbortController();
    req.signal.addEventListener("abort", () => stop.abort(), { once: true });

    let usage: LlmUsage | undefined;
    let model: string | undefined;
    const origin = new URL(req.url).origin;
    const replyText = streamWithFallback(
      chain,
      buildMessages(
        history,
        message,
        image && { data: image.data, mediaType: image.mediaType },
        document && { name: document.name, text: document.text, pdf: document.pdf },
      ),
      {
        system: systemPrompt(),
        // Asking for a Word/PDF/Excel/PowerPoint file: room for a whole document.
        maxTokens: asksForFile(message) ? MAX_FILE_OUTPUT_TOKENS : MAX_OUTPUT_TOKENS,
        onUsage: (u) => (usage = u),
        onModel: (name) => (model = name),
        abortSignal: stop.signal,
      },
    );
    // Files the model writes (<bubble-file> blocks) are built, saved and linked here.
    const reply = withFiles(replyText, {
      signal: stop.signal,
      make: async ({ format, name, content }) => {
        const { data } = await renderFile(format, name, content);
        return saveFile({ uid: user.uid, conversationId, origin }, { format, name, data });
      },
    });

    return await streamAndPersist(
      reply,
      async (text) => {
        await userSaved;
        await appendAssistantMessage(user.uid, conversationId, assistantMessageId, text, usage && { day, tokens: usage }, model);
      },
      { stop, headers: { "X-Messages-Left": String(limit.remaining) } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
