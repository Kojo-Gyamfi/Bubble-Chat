import { FieldValue } from "firebase-admin/firestore";
import { errorResponse, forgetRevocationState, requireUser } from "@/lib/auth";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

/**
 * "Unlink all devices": revokes every refresh token for the account, which
 * signs out the bubble app and all browsers (including the caller) once their
 * current ID token is rejected. Other server instances notice within 5 minutes
 * (lib/auth.ts caches the revocation lookup).
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    await adminAuth().revokeRefreshTokens(user.uid);
    forgetRevocationState(user.uid);
    // The bubble is signed out now, so /link should offer a new link again.
    await adminDb().doc(`users/${user.uid}`).set({ bubbleSeenAt: FieldValue.delete() }, { merge: true });
    console.info(`Revoked all sessions for uid=${user.uid}`);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
