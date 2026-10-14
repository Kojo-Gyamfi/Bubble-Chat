import "server-only";

import type { DecodedIdToken } from "firebase-admin/auth";
import { adminAuth, adminDb } from "@/lib/firebase/admin";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface AuthedUser {
  uid: string;
  email: string | null;
  name: string | null;
}

/**
 * Verifies the Firebase ID token in `Authorization: Bearer <token>` and checks
 * the user is allowed. Throws HttpError(401/403) otherwise.
 */
export async function requireUser(req: Request): Promise<AuthedUser> {
  const match = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
  if (!match) throw new HttpError(401, "Missing token");

  let token: DecodedIdToken;
  try {
    // checkRevoked: "Unlink all devices" revokes refresh tokens.
    token = await adminAuth().verifyIdToken(match[1], true);
  } catch {
    throw new HttpError(401, "Invalid or revoked token");
  }

  if (!(await isAllowed(token))) throw new HttpError(403, "This account is not on the allowlist");
  return { uid: token.uid, email: token.email ?? null, name: token.name ?? null };
}

const backfilled = new Set<string>();

async function isAllowed(token: DecodedIdToken): Promise<boolean> {
  if (token.allowed === true) return true;
  if (token.allowed === false) return false;

  const email = token.email?.toLowerCase();
  if (!email || token.email_verified !== true) return false;
  const entry = await adminDb().doc(`allowlist/${email}`).get();
  if (!entry.exists) return false;

  // Set the claim so later sessions (including the bubble's custom-token
  // session, whose ID token may lack `email`) pass without the lookup.
  if (!backfilled.has(token.uid)) {
    backfilled.add(token.uid);
    await adminAuth()
      .setCustomUserClaims(token.uid, { allowed: true })
      .catch((err) => console.error("Failed to set allowed claim", err));
  }
  return true;
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  return Response.json({ error: "Internal error" }, { status: 500 });
}
