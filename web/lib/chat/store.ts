import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type { AuthedUser } from "@/lib/auth";
import { adminDb } from "@/lib/firebase/admin";
import { titleFrom } from "@/lib/chat/schema";

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

export async function appendAssistantMessage(
  uid: string,
  conversationId: string,
  messageId: string,
  content: string,
): Promise<void> {
  const convRef = conversationRef(uid, conversationId);
  const now = FieldValue.serverTimestamp();
  const batch = adminDb().batch();
  batch.set(convRef.collection("messages").doc(messageId), { role: "assistant", content, createdAt: now });
  batch.update(convRef, { updatedAt: now, messageCount: FieldValue.increment(1) });
  await batch.commit();
}
