// Runs against the Firestore emulator: `npm run test:rules`.
import fs from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let env: RulesTestEnvironment;

const ALICE = { uid: "alice", email: "alice@example.com" };

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-bubble",
    firestore: { rules: fs.readFileSync(path.resolve(import.meta.dirname, "../../firestore.rules"), "utf8") },
  });
});

afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "allowlist/alice@example.com"), { addedAt: new Date() });
    await setDoc(doc(db, "users/alice/conversations/c1"), { title: "Hi" });
    await setDoc(doc(db, "users/alice/conversations/c1/messages/m1"), { role: "user", content: "hi" });
    await setDoc(doc(db, "users/alice"), { email: ALICE.email, bubbleSeenAt: new Date() });
    await setDoc(doc(db, "users/bob"), { email: "bob@example.com" });
    await setDoc(doc(db, "users/bob/conversations/c2"), { title: "Bob's" });
    await setDoc(doc(db, "usage/alice_2026-10-14"), { requests: 1 });
  });
});

/** Google sign-in token: verified email, no custom claim yet. */
function googleUser(uid: string, email: string) {
  return env.authenticatedContext(uid, { email, email_verified: true }).firestore();
}

describe("allowlisted user", () => {
  it("can read their own conversations and messages", async () => {
    const db = googleUser(ALICE.uid, ALICE.email);
    await assertSucceeds(getDocs(collection(db, "users/alice/conversations")));
    await assertSucceeds(getDocs(collection(db, "users/alice/conversations/c1/messages")));
    // Profile doc: /link reads bubbleSeenAt from it.
    await assertSucceeds(getDoc(doc(db, "users/alice")));
  });

  it("is matched case-insensitively", async () => {
    await assertSucceeds(getDoc(doc(googleUser(ALICE.uid, "Alice@Example.com"), "users/alice/conversations/c1")));
  });

  it("cannot write anything (the server writes)", async () => {
    const db = googleUser(ALICE.uid, ALICE.email);
    await assertFails(setDoc(doc(db, "users/alice/conversations/c1/messages/m2"), { role: "assistant", content: "x" }));
    await assertFails(setDoc(doc(db, "users/alice/conversations/c3"), { title: "new" }));
    await assertFails(deleteDoc(doc(db, "users/alice/conversations/c1")));
    await assertFails(setDoc(doc(db, "users/alice"), { bubbleSeenAt: new Date() }, { merge: true }));
  });

  it("cannot read other users' data, the allowlist or usage", async () => {
    const db = googleUser(ALICE.uid, ALICE.email);
    await assertFails(getDocs(collection(db, "users/bob/conversations")));
    await assertFails(getDoc(doc(db, "users/bob")));
    await assertFails(getDoc(doc(db, "allowlist/alice@example.com")));
    await assertFails(getDoc(doc(db, "usage/alice_2026-10-14")));
  });

  it("is denied with an unverified email", async () => {
    const db = env.authenticatedContext(ALICE.uid, { email: ALICE.email, email_verified: false }).firestore();
    await assertFails(getDocs(collection(db, "users/alice/conversations")));
  });
});

describe("non-allowlisted user", () => {
  it("cannot read even their own tree", async () => {
    const db = googleUser("mallory", "mallory@example.com");
    await assertFails(getDocs(collection(db, "users/mallory/conversations")));
  });
});

describe("custom claims", () => {
  it("allowed=true works without an email (bubble custom-token session)", async () => {
    const db = env.authenticatedContext(ALICE.uid, { allowed: true }).firestore();
    await assertSucceeds(getDocs(collection(db, "users/alice/conversations/c1/messages")));
  });

  it("allowed=false denies even an allowlisted email (removed user)", async () => {
    const db = env.authenticatedContext(ALICE.uid, { email: ALICE.email, email_verified: true, allowed: false }).firestore();
    await assertFails(getDocs(collection(db, "users/alice/conversations")));
  });
});

describe("signed-out visitor", () => {
  it("cannot read anything", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDocs(collection(db, "users/alice/conversations")));
    await assertFails(getDoc(doc(db, "allowlist/alice@example.com")));
  });
});
