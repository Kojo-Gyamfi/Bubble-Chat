import { type FirebaseApp, getApps, initializeApp } from "firebase/app";
import {
  type Auth,
  connectAuthEmulator,
  GoogleAuthProvider,
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { connectFirestoreEmulator, type Firestore, getFirestore } from "firebase/firestore";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId);

// Local development against `firebase emulators:start` (never in production).
const useEmulators = process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS === "true";

let app: FirebaseApp | undefined;
let authInstance: Auth | undefined;
let dbInstance: Firestore | undefined;

// Initialised lazily and only in the browser, so prerendering never touches
// the SDK (and a missing .env.local doesn't break the build).
function firebaseApp(): FirebaseApp {
  if (!app) app = getApps()[0] ?? initializeApp(config);
  return app;
}

export function auth(): Auth {
  if (!authInstance) {
    authInstance = getAuth(firebaseApp());
    if (useEmulators) connectAuthEmulator(authInstance, "http://127.0.0.1:9099", { disableWarnings: true });
  }
  return authInstance;
}

export function db(): Firestore {
  if (!dbInstance) {
    dbInstance = getFirestore(firebaseApp());
    if (useEmulators) connectFirestoreEmulator(dbInstance, "127.0.0.1", 8080);
  }
  return dbInstance;
}

// iOS home-screen apps can't complete a popup; use a redirect there.
function isIosStandalone(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

export async function signInWithGoogle(): Promise<void> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  if (isIosStandalone()) {
    await signInWithRedirect(auth(), provider);
  } else {
    await signInWithPopup(auth(), provider);
  }
}

export function signOut(): Promise<void> {
  return firebaseSignOut(auth());
}
