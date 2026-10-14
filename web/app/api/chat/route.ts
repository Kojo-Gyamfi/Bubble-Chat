import { errorResponse, requireUser } from "@/lib/auth";
import { mockReply } from "@/lib/chat/mock";
import { chatRequestSchema } from "@/lib/chat/schema";
import { appendAssistantMessage, appendUserMessage } from "@/lib/chat/store";
import { streamAndPersist } from "@/lib/chat/stream";

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

    await appendUserMessage(user, conversationId, userMessageId, message);

    return streamAndPersist(mockReply(message), (text) =>
      appendAssistantMessage(user.uid, conversationId, assistantMessageId, text),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
