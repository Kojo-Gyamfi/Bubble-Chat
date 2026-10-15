"use client";

import { Link2Off, LogIn, TimerOff } from "lucide-react";
import Link from "next/link";
import { OverlayChat } from "@/components/overlay/OverlayChat";
import { FullScreenSpinner } from "@/components/Spinner";
import { Notice, PrimaryButton } from "@/components/ui";
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
      <Notice
        icon={LogIn}
        title="Not signed in"
        action={
          <Link
            href="/login?next=/overlay"
            className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground"
          >
            Sign in
          </Link>
        }
      >
        Sign in to use the compact chat.
      </Notice>
    );
  }

  const expired = auth.reason === "link-failed";
  return (
    <Notice
      icon={expired ? TimerOff : Link2Off}
      title={expired ? "Link expired" : "Re-link in the app"}
      action={
        <PrimaryButton onClick={() => bridge.openInBrowser(`${window.location.origin}/link`)}>Get a new link</PrimaryButton>
      }
    >
      {expired
        ? "That link has expired (links last an hour). Create a new one in the web app, then open it on this phone."
        : "The bubble isn't signed in. Create a link in the web app, then open it on this phone."}
    </Notice>
  );
}
