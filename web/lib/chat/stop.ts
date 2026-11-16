import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";

/**
 * The Stop button, independent of the connection. Closing the request is
 * enough locally, but on Vercel the function doesn't learn that the client
 * went away, so it would keep generating (and save the whole reply). So Stop
 * also calls POST /api/chat/stop, which writes a marker the chat function is
 * watching: users/{uid}/conversations/{id}/stops/{assistantMessageId}.
 * It's deleted with the conversation.
 */
function stopRef(uid: string, conversationId: string, messageId: string) {
  return adminDb().doc(`users/${uid}/conversations/${conversationId}/stops/${messageId}`);
}

export async function requestStop(uid: string, conversationId: string, messageId: string): Promise<void> {
  await stopRef(uid, conversationId, messageId).set({ at: FieldValue.serverTimestamp() });
}

/**
 * Calls `onStop` once if Stop is pressed for this reply (also if it was pressed
 * before we started watching). Returns a function that stops watching and
 * tidies the marker away.
 */
export function watchStop(uid: string, conversationId: string, messageId: string, onStop: () => void): () => void {
  const ref = stopRef(uid, conversationId, messageId);
  let stopped = false;
  let unsubscribe: (() => void) | null = null;
  try {
    unsubscribe = ref.onSnapshot(
      (snap) => {
        if (snap.exists && !stopped) {
          stopped = true;
          onStop();
        }
      },
      (err) => console.warn("Stop listener failed (Stop falls back to the connection closing)", err.message),
    );
  } catch (err) {
    console.warn("Could not watch for Stop", err);
  }
  return () => {
    unsubscribe?.();
    unsubscribe = null;
    if (stopped) ref.delete().catch(() => {});
  };
}
