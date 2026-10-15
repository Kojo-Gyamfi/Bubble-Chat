import { errorResponse, requireUser } from "@/lib/auth";
import { adminAuth } from "@/lib/firebase/admin";
import { consumeDeviceLink, dayKey, DEVICE_LINKS_PER_DAY } from "@/lib/usage";

export const runtime = "nodejs";

// Firebase custom tokens are valid for one hour.
const TOKEN_LIFETIME_MS = 60 * 60 * 1000;

/**
 * Mints a custom token for linking the bubble app, which can't run Google
 * sign-in in its WebView. The PWA shows it as bubble://link?token=…; the app
 * hands it to /overlay, which calls signInWithCustomToken.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);

    if (!(await consumeDeviceLink(user.uid, dayKey()))) {
      return Response.json(
        { error: `You can create ${DEVICE_LINKS_PER_DAY} links per day. Try again tomorrow.` },
        { status: 429 },
      );
    }

    // `allowed` rides along so the bubble session passes the allowlist even if
    // its ID token carries no email claim.
    const token = await adminAuth().createCustomToken(user.uid, { allowed: true });
    console.info(`Issued bubble link token for uid=${user.uid}`);

    return Response.json(
      {
        deepLink: `bubble://link?token=${encodeURIComponent(token)}`,
        expiresAt: Date.now() + TOKEN_LIFETIME_MS,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
