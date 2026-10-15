import { FieldValue } from "firebase-admin/firestore";
import { errorResponse, HttpError, requireUser } from "@/lib/auth";
import { adminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

/**
 * Called by /overlay each time the bubble app opens signed in. Records
 * `bubbleSeenAt` on users/{uid}, so the PWA's /link page can show "already
 * linked" instead of offering a new link. "Unlink all devices" clears it.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    // Only sessions from a bubble link (custom token) count, not browsers.
    if (user.provider !== "custom") throw new HttpError(400, "Not a bubble app session");

    await adminDb()
      .doc(`users/${user.uid}`)
      .set({ bubbleSeenAt: FieldValue.serverTimestamp() }, { merge: true });
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
