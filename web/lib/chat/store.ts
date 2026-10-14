import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type { AuthedUser } from "@/lib/auth";
import { adminDb } from "@/lib/firebase/admin";
import { titleFrom } from "@/lib/chat/schema";
import type { LlmMessage, LlmUsage } from "@/lib/llm";
import { usageDocIds } from "@/lib/usage";

// All message writes happen here, server-side. Clients only read.

function conversationRef(uid: string, conversationId: string) {
  return adminDb().doc(`users/${uid}/conversations/${conversationId}`);
}

export async function appendUserMessage(
  user: AuthedUser,
  conversationId: string,
  messageId: string,
  content: string,
): Promise<void> {
  const db = adminDb();
  const userRef = db.doc(`users/${user.uid}`);
  const convRef = conversationRef(user.uid, conversationId);
  const now = FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    const [userSnap, convSnap] = await tx.getAll(userRef, convRef);

    tx.set(
      userRef,
      {
        email: user.email,
        displayName: user.name,
        lastSeenAt: now,
        ...(userSnap.exists ? {} : { createdAt: now }),
      },
      { merge: true },
    );

    if (convSnap.exists) {
      tx.update(convRef, { updatedAt: now, messageCount: FieldValue.increment(1) });
    } else {
      tx.set(convRef, { title: titleFrom(content), createdAt: now, updatedAt: now, messageCount: 1 });
    }

    tx.set(convRef.collection("messages").doc(messageId), { role: "user", content, createdAt: now });
  });
}

/** Most recent `limit` messages of a conversation, oldest first, excluding `excludeId`. */
export async function loadHistory(
  uid: string,
  conversationId: string,
  limit: number,
  excludeId: string,
): Promise<LlmMessage[]> {
  const snap = await conversationRef(uid, conversationId)
    .collection("messages")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs
    .filter((d) => d.id !== excludeId)
    .reverse()
    .map((d) => ({
      role: d.get("role") as LlmMessage["role"],
      content: d.get("content") as string,
    }));
}

/** Saves the reply and its token usage in one batch. */
export async function appendAssistantMessage(
  uid: string,
  conversationId: string,
  messageId: string,
  content: string,
  usage?: { day: string; tokens: LlmUsage },
): Promise<void> {
  const db = adminDb();
  const convRef = conversationRef(uid, conversationId);
  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(convRef.collection("messages").doc(messageId), {
    role: "assistant",
    content,
    createdAt: now,
    ...(usage ? { tokens: usage.tokens.outputTokens } : {}),
  });
  batch.update(convRef, { updatedAt: now, messageCount: FieldValue.increment(1) });
  if (usage) {
    const ids = usageDocIds(uid, usage.day);
    const tokens = {
      inputTokens: FieldValue.increment(usage.tokens.inputTokens),
      outputTokens: FieldValue.increment(usage.tokens.outputTokens),
    };
    batch.set(db.doc(ids.user), tokens, { merge: true });
    batch.set(db.doc(ids.global), tokens, { merge: true });
  }
  await batch.commit();
}
