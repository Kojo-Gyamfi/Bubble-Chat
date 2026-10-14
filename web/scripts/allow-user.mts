// Manage the allowlist from your machine (uses the service account in .env.local).
//
//   npm run allow -- add friend@gmail.com
//   npm run allow -- remove friend@gmail.com
//   npm run allow -- list

import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
if (!encoded) {
  console.error("FIREBASE_SERVICE_ACCOUNT_BASE64 is not set (run via `npm run allow`).");
  process.exit(1);
}
initializeApp({ credential: cert(JSON.parse(Buffer.from(encoded, "base64").toString("utf8"))) });
const auth = getAuth();
const db = getFirestore();

const [command, rawEmail] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();

async function findUid(address: string): Promise<string | null> {
  try {
    return (await auth.getUserByEmail(address)).uid;
  } catch {
    return null; // hasn't signed in yet; the claim is set on first request
  }
}

switch (command) {
  case "add": {
    if (!email) throw new Error("Usage: add <email>");
    await db.doc(`allowlist/${email}`).set({ addedAt: new Date() });
    const uid = await findUid(email);
    if (uid) await auth.setCustomUserClaims(uid, { allowed: true });
    console.log(`Added ${email}${uid ? " (claim set)" : ""}`);
    break;
  }
  case "remove": {
    if (!email) throw new Error("Usage: remove <email>");
    await db.doc(`allowlist/${email}`).delete();
    const uid = await findUid(email);
    if (uid) {
      // An explicit false overrides any lingering allowlist lookups, and
      // revoking refresh tokens signs out every session, including the bubble.
      await auth.setCustomUserClaims(uid, { allowed: false });
      await auth.revokeRefreshTokens(uid);
    }
    console.log(`Removed ${email}${uid ? " (claim cleared, sessions revoked)" : ""}`);
    break;
  }
  case "list": {
    const snap = await db.collection("allowlist").get();
    for (const doc of snap.docs) console.log(doc.id);
    console.log(`${snap.size} allowed`);
    break;
  }
  default:
    console.error("Usage: npm run allow -- add|remove|list [email]");
    process.exit(1);
}
