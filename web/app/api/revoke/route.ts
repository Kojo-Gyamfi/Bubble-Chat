import { errorResponse, requireUser } from "@/lib/auth";
import { adminAuth } from "@/lib/firebase/admin";

export const runtime = "nodejs";

/**
 * "Unlink all devices": revokes every refresh token for the account, which
 * signs out the bubble app and all browsers (including the caller) once their
 * current ID token is rejected. /api/chat verifies with checkRevoked.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    await adminAuth().revokeRefreshTokens(user.uid);
    console.info(`Revoked all sessions for uid=${user.uid}`);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
