import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";

export interface Limits {
  perUser: number;
  global: number;
}

function intEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function limitsFromEnv(): Limits {
  return {
    perUser: intEnv("DAILY_REQUEST_LIMIT", 25),
    global: intEnv("GLOBAL_DAILY_REQUEST_LIMIT", 200),
  };
}

/** Usage days are UTC dates (YYYY-MM-DD); limits reset at 00:00 UTC. */
export function dayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export type LimitResult =
  | { ok: true; /** The user's messages left today after this one. */ remaining: number }
  | { ok: false; scope: "user" | "global"; limit: number };

export function checkLimits(userRequests: number, globalRequests: number, limits: Limits): LimitResult {
  if (userRequests >= limits.perUser) return { ok: false, scope: "user", limit: limits.perUser };
  if (globalRequests >= limits.global) return { ok: false, scope: "global", limit: limits.global };
  return { ok: true, remaining: limits.perUser - userRequests - 1 };
}

/** The user's messages left today, for the counter under the composer (no write). */
export async function remainingToday(uid: string, day: string, limits = limitsFromEnv()) {
  const db = adminDb();
  const ids = usageDocIds(uid, day);
  const [userSnap, globalSnap] = await db.getAll(db.doc(ids.user), db.doc(ids.global));
  const used = (userSnap.get("requests") as number | undefined) ?? 0;
  const globalUsed = (globalSnap.get("requests") as number | undefined) ?? 0;
  // Everyone is out once the shared cap is hit.
  const remaining = globalUsed >= limits.global ? 0 : Math.max(0, limits.perUser - used);
  return { remaining, limit: limits.perUser };
}

export function limitMessage(result: Extract<LimitResult, { ok: false }>): string {
  return result.scope === "user"
    ? `You've used all ${result.limit} messages for today. The limit resets at midnight UTC.`
    : "The chat has hit its shared daily limit. It resets at midnight UTC.";
}

export function usageDocIds(uid: string, day: string) {
  return { user: `usage/${uid}_${day}`, global: `usage/global_${day}` };
}

export const DEVICE_LINKS_PER_DAY = 5;

/** Counts one bubble link token against the user's daily cap; false if over it. */
export async function consumeDeviceLink(uid: string, day: string): Promise<boolean> {
  const db = adminDb();
  const ref = db.doc(usageDocIds(uid, day).user);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (((snap.get("deviceLinks") as number | undefined) ?? 0) >= DEVICE_LINKS_PER_DAY) return false;
    tx.set(ref, { uid, day, deviceLinks: FieldValue.increment(1) }, { merge: true });
    return true;
  });
}

/**
 * Counts one request against the per-user and global daily caps, atomically
 * and *before* calling the model, so failed or parallel requests can't
 * overshoot.
 */
export async function consumeRequest(uid: string, day: string, limits = limitsFromEnv()): Promise<LimitResult> {
  const db = adminDb();
  const ids = usageDocIds(uid, day);
  const userRef = db.doc(ids.user);
  const globalRef = db.doc(ids.global);

  return db.runTransaction(async (tx) => {
    const [userSnap, globalSnap] = await tx.getAll(userRef, globalRef);
    const result = checkLimits(
      (userSnap.get("requests") as number | undefined) ?? 0,
      (globalSnap.get("requests") as number | undefined) ?? 0,
      limits,
    );
    if (!result.ok) return result;

    const increment = { requests: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() };
    tx.set(userRef, { uid, day, ...increment }, { merge: true });
    tx.set(globalRef, { day, ...increment }, { merge: true });
    return result;
  });
}
