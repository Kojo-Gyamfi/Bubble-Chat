import { errorResponse, requireUser } from "@/lib/auth";
import { dayKey, remainingToday } from "@/lib/usage";

export const runtime = "nodejs";

/** Messages left today, for the "N messages left" hint (usage docs are server-only). */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    return Response.json(await remainingToday(user.uid, dayKey()), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
