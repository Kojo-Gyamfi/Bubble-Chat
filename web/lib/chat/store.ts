import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type { AuthedUser } from "@/lib/auth";
import { adminDb } from "@/lib/firebase/admin";
import { titleFrom } from "@/lib/chat/schema";
import type { LlmMessage, LlmUsage } from "@/lib/llm";
import { PAST_PHOTO_NOTE } from "@/lib/prompt";
import { documentAsText, type ReadDocument } from "@/lib/chat/documents";
import { dayKey, usageDocIds } from "@/lib/usage";

// All message writes happen here, server-side. Clients only read.

function conversationRef(uid: string, conversationId: string) {
  return adminDb().doc(`users/${uid}/conversations/${conversationId}`);
}

export async function appendUserMessage(
  user: AuthedUser,
  conversationId: string,
  messageId: string,
  content: string,
  attachment: {
    /** Thumbnail data URL of an attached photo (the full image isn't stored). */
    image?: string;
    /** Attached document: its text is kept (server-only doc) for follow-up questions. */
    document?: ReadDocument;
  } = {},
): Promise<void> {
  const { image, document } = attachment;
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
        // The bubble's "linked" marker can create the doc without createdAt.
        ...(userSnap.get("createdAt") ? {} : { createdAt: now }),
      },
      { merge: true },
    );

    if (convSnap.exists) {
      tx.update(convRef, { updatedAt: now, messageCount: FieldValue.increment(1) });
    } else {
      tx.set(convRef, {
        title: titleFrom(content || (document ? `📄 ${document.name}` : "")),
        createdAt: now,
        updatedAt: now,
        messageCount: 1,
      });
    }

    tx.set(convRef.collection("messages").doc(messageId), {
      role: "user",
      content,
      createdAt: now,
      ...(image ? { image } : {}),
      ...(document ? { file: { name: document.name, mediaType: document.mediaType, size: document.size } } : {}),
    });
    // The text lives apart from the message, so chat screens never download it.
    if (document) {
      tx.set(convRef.collection("attachments").doc(messageId), {
        name: document.name,
        mediaType: document.mediaType,
        text: document.text,
        createdAt: now,
      });
    }
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
  const docs = snap.docs.filter((d) => d.id !== excludeId).reverse();

  // Documents attached earlier come back as text, newest first, within a budget.
  const texts = new Map<string, string>();
  const withFiles = docs.filter((d) => d.get("file"));
  if (withFiles.length) {
    const attachments = conversationRef(uid, conversationId).collection("attachments");
    let budget = MAX_HISTORY_DOCUMENT_CHARS;
    for (const att of (await adminDb().getAll(...withFiles.map((d) => attachments.doc(d.id)))).reverse()) {
      const text = (att.get("text") as string | undefined) ?? "";
      if (!att.exists || text.length > budget) continue;
      budget -= text.length;
      texts.set(att.id, text);
    }
  }

  return docs.map((d) => {
    let content = d.get("content") as string;
    if (d.get("image")) content = `${PAST_PHOTO_NOTE}\n${content}`.trim();
    const file = d.get("file") as { name: string } | undefined;
    if (file) {
      const text = texts.get(d.id);
      const note = text === undefined ? `[Attached file: ${file.name}] ${OLD_DOCUMENT_NOTE}` : documentAsText(file.name, text);
      content = `${content}\n\n${note}`.trim();
    }
    return { role: d.get("role") as LlmMessage["role"], content };
  });
}

/** Document text re-sent with history for follow-ups (~15k tokens; the newest documents win). */
const MAX_HISTORY_DOCUMENT_CHARS = 60_000;
const OLD_DOCUMENT_NOTE = "(not included any more; ask the user to attach it again if needed)";

/** Saves the reply and its token usage in one batch. */
export async function appendAssistantMessage(
  uid: string,
  conversationId: string,
  messageId: string,
  content: string,
  usage?: { day: string; tokens: LlmUsage },
  /** Which model answered, e.g. "gemini:gemini-3.6-flash" (for the owner; not shown in the chat). */
  model?: string,
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
    ...(model ? { model } : {}),
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
  if (model) {
    // usage/global_{day}.models: replies per model today ("." and "/" aren't nice in keys).
    const key = model.replace(/[./]/g, "_");
    batch.set(db.doc(usageDocIds(uid, usage?.day ?? dayKey()).global), { models: { [key]: FieldValue.increment(1) } }, { merge: true });
  }
  await batch.commit();
}
