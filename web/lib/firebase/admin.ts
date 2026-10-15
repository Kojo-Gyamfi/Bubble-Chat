import "server-only";

import { type App, cert, getApps, initializeApp } from "firebase-admin/app";
import { type Auth, getAuth } from "firebase-admin/auth";
import { type Firestore, getFirestore } from "firebase-admin/firestore";

// Singleton: Vercel reuses warm instances, and Next dev reloads modules.
function adminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!encoded) {
    // Against the local emulators no credentials are needed (the admin SDK
    // picks up FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST itself).
    if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
      return initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID });
    }
    throw new Error("FIREBASE_SERVICE_ACCOUNT_BASE64 is not set");
  }
  const serviceAccount = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  return initializeApp({ credential: cert(serviceAccount) });
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}

export function adminDb(): Firestore {
  return getFirestore(adminApp());
}
