"use client";

import Link from "next/link";
import { OverlayChat, OverlayNotice } from "@/components/overlay/OverlayChat";
import { FullScreenSpinner } from "@/components/Spinner";
import { bridge } from "@/lib/bridge";
import { useIsNative, useOverlayAuth } from "@/lib/overlay-auth";

export default function OverlayPage() {
  const auth = useOverlayAuth();
  const native = useIsNative();

  if (auth.state === "loading") return <FullScreenSpinner />;
  if (auth.state === "ready") return <OverlayChat user={auth.user} />;

  if (!native) {
    // Plain browser (e.g. testing in Chrome DevTools at 320×480).
    return (
      <OverlayNotice
        title="Not signed in"
        action={
          <Link href="/login?next=/overlay" className="inline-block text-sm underline">
            Sign in
          </Link>
        }
      >
        Sign in to use the compact chat.
      </OverlayNotice>
    );
  }

  return (
    <OverlayNotice
      title={auth.reason === "link-failed" ? "Link expired" : "Re-link in the app"}
      action={
        <button
          type="button"
          onClick={() => bridge.openInBrowser(`${window.location.origin}/link`)}
          className="mt-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          Get a new link
        </button>
      }
    >
      {auth.reason === "link-failed"
        ? "That link has expired (links last an hour). Create a new one in the web app, then open it on this phone."
        : "The bubble isn't signed in. Create a link in the web app, then open it on this phone."}
    </OverlayNotice>
  );
}
