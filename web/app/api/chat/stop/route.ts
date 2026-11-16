import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { requestStop } from "@/lib/chat/stop";

export const runtime = "nodejs";

const docId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const stopSchema = z.object({ conversationId: docId, assistantMessageId: docId });

/** The Stop button: ends the reply being generated for this message (see lib/chat/stop.ts). */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const parsed = stopSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
    await requestStop(user.uid, parsed.data.conversationId, parsed.data.assistantMessageId);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
