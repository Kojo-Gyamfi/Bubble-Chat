import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { type FileFormat, fileNameOf, FORMAT_INFO } from "@/lib/chat/file-blocks";
import { adminDb } from "@/lib/firebase/admin";

/**
 * Created files are stored in Firestore next to the conversation
 * (users/{uid}/conversations/{id}/files/{fileId}), so deleting the
 * conversation deletes them too. Firebase Storage would need the paid plan;
 * a Firestore document holds up to 1 MiB, plenty for generated documents.
 */
export const MAX_FILE_BYTES = 900 * 1024;

export class FileTooLargeError extends Error {}

function filesRef(uid: string, conversationId: string) {
  return adminDb().collection(`users/${uid}/conversations/${conversationId}/files`);
}

/**
 * Download links are signed, so they work without a sign-in header: tapping
 * one in the bubble opens Chrome, which downloads the file. The key comes from
 * FILE_LINK_SECRET, else from the service account (always set in production).
 */
function linkKey(): string {
  const secret = process.env.FILE_LINK_SECRET || process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || "bubble-dev-only";
  return createHash("sha256").update(`bubble-file-links:${secret}`).digest("hex");
}

export function signFile(uid: string, conversationId: string, fileId: string): string {
  return createHmac("sha256", linkKey()).update(`${uid}/${conversationId}/${fileId}`).digest("base64url").slice(0, 32);
}

export function verifyFileSignature(uid: string, conversationId: string, fileId: string, signature: string): boolean {
  const expected = Buffer.from(signFile(uid, conversationId, fileId));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Saves a created file and returns its download link (absolute, so it also works outside the app). */
export async function saveFile(
  { uid, conversationId, origin }: { uid: string; conversationId: string; origin: string },
  file: { format: FileFormat; name: string; data: Buffer },
): Promise<{ href: string }> {
  if (file.data.length > MAX_FILE_BYTES) throw new FileTooLargeError(`${file.data.length} bytes`);
  const ref = filesRef(uid, conversationId).doc();
  await ref.set({
    name: fileNameOf(file),
    format: file.format,
    mimeType: FORMAT_INFO[file.format].mimeType,
    size: file.data.length,
    data: file.data,
    createdAt: FieldValue.serverTimestamp(),
  });
  const path = [uid, conversationId, ref.id, encodeURIComponent(fileNameOf(file))].join("/");
  return { href: `${origin}/api/files/${path}?s=${signFile(uid, conversationId, ref.id)}` };
}

export async function loadFile(
  uid: string,
  conversationId: string,
  fileId: string,
): Promise<{ name: string; mimeType: string; data: Buffer } | null> {
  const snap = await filesRef(uid, conversationId).doc(fileId).get();
  if (!snap.exists) return null;
  const data = snap.get("data") as Buffer | Uint8Array | undefined;
  if (!data) return null;
  return {
    name: (snap.get("name") as string) || "file",
    mimeType: (snap.get("mimeType") as string) || "application/octet-stream",
    data: Buffer.from(data),
  };
}
