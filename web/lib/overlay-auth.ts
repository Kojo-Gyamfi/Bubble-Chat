"use client";

import { signInWithCustomToken, type User } from "firebase/auth";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/components/AuthProvider";
import { bridge } from "@/lib/bridge";
import { auth } from "@/lib/firebase/client";

const noSubscribe = () => () => {};

/** True inside the bubble app's WebView (window.Android exists). SSR-safe. */
export function useIsNative(): boolean {
  return useSyncExternalStore(noSubscribe, bridge.isNative, () => false);
}

/** uid claim of a Firebase custom token (a JWT); no verification needed here. */
function tokenUid(token: string): string | null {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return (JSON.parse(atob(payload)) as { uid?: string }).uid ?? null;
  } catch {
    return null;
  }
}

export type OverlayAuth =
  | { state: "loading" }
  | { state: "ready"; user: User }
  | { state: "unlinked"; reason: "no-session" | "link-failed" };

/**
 * Auth for /overlay. Google sign-in can't run in the WebView, so the bubble
 * app passes the custom token from its bubble://link deep link via
 * Android.getAuthToken(). We sign in with it once; Firebase then keeps its
 * own refresh token in the WebView's storage, and Android.onLinked() lets the
 * app delete the (one-hour) custom token. In a normal browser this is just
 * the regular Firebase session.
 */
export function useOverlayAuth(): OverlayAuth {
  const { user } = useAuth();
  const [token] = useState(() => bridge.getAuthToken());
  const [failedToken, setFailedToken] = useState<string | null>(null);

  const tokenOwner = token ? tokenUid(token) : null;
  // Sign in when there's a fresh token for someone other than the current user.
  const mustSignIn = !!token && token !== failedToken && user !== undefined && user?.uid !== tokenOwner;

  useEffect(() => {
    if (!mustSignIn) return;
    let cancelled = false;
    signInWithCustomToken(auth(), token)
      .then(() => bridge.onLinked())
      .catch((err: unknown) => {
        console.error("Bubble link sign-in failed", err);
        if (!cancelled) setFailedToken(token);
      });
    return () => {
      cancelled = true;
    };
  }, [mustSignIn, token]);

  // Already signed in as the token's user: the token isn't needed any more.
  const alreadyLinked = !!token && !!user && user.uid === tokenOwner;
  useEffect(() => {
    if (alreadyLinked) bridge.onLinked();
  }, [alreadyLinked]);

  if (user === undefined || mustSignIn) return { state: "loading" };
  if (user === null) return { state: "unlinked", reason: failedToken ? "link-failed" : "no-session" };
  return { state: "ready", user };
}
