import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

// Clients can't delete subcollections, so deletion happens here.
export async function DELETE(req: Request, ctx: RouteContext<"/api/conversations/[id]">) {
  try {
    const user = await requireUser(req);
    const parsed = idSchema.safeParse((await ctx.params).id);
    if (!parsed.success) return Response.json({ error: "Invalid id" }, { status: 400 });

    await adminDb().recursiveDelete(adminDb().doc(`users/${user.uid}/conversations/${parsed.data}`));
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
