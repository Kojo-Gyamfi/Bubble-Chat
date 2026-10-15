"use client";

import type { User } from "firebase/auth";
import {
  AlertCircle,
  ArrowLeft,
  CircleCheck,
  ExternalLink,
  Loader2,
  Smartphone,
  Unlink,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Credit, PrimaryButton, SecondaryButton } from "@/components/ui";
import { createDeviceLink, type DeviceLink, revokeAllSessions } from "@/lib/chat/client";
import { friendlyError, useBubbleSeenAt } from "@/lib/chat/hooks";
import { signOut } from "@/lib/firebase/client";

export default function LinkBubblePage() {
  const { user } = useAuth();
  if (!user) return null; // the (app) layout handles signed-out users
  return <LinkBubble user={user} />;
}

function LinkBubble({ user }: { user: User }) {
  const seenAt = useBubbleSeenAt(user.uid);
  // A link plus the bubble's last-seen time when it was made: once the bubble
  // reports in after that, the page flips to "linked" by itself.
  const [link, setLink] = useState<(DeviceLink & { seenBefore: Date | null }) | null>(null);
  const [relinking, setRelinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  const usedSinceLink = !!link && !!seenAt && (!link.seenBefore || seenAt > link.seenBefore);
  const linked = !!seenAt && (link ? usedSinceLink : !relinking);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      setLink({ ...(await createDeviceLink(user)), seenBefore: seenAt ?? null });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  function linkAgain() {
    setLink(null);
    setRelinking(true);
  }

  async function unlinkAll() {
    setUnlinking(true);
    try {
      await revokeAllSessions(user);
      await signOut(); // this browser's session is revoked too
    } catch (err) {
      setError(friendlyError(err));
      setUnlinking(false);
    }
  }

  const expiresAt = link ? new Date(link.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <main className="safe-area mx-auto min-h-dvh w-full max-w-xl">
      <Link
        href="/"
        className="-ml-2 inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to chat
      </Link>

      <div className="mt-6 flex items-center gap-3 animate-fade-up">
        <div className="flex size-11 items-center justify-center rounded-xl bg-surface">
          <Smartphone className="size-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Link the bubble app</h1>
          <p className="text-sm text-muted-foreground">Chat from a floating bubble over any Android app.</p>
        </div>
      </div>

      <section className="mt-8 rounded-2xl border border-border p-5">
        {seenAt === undefined ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Checking your bubble app…
          </div>
        ) : linked ? (
          <div className="animate-fade-up">
            <div className="flex items-start gap-3">
              <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
              <div className="min-w-0">
                <h2 className="font-medium">Bubble app already linked</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {usedSinceLink ? "Linked just now. " : ""}Last used {formatSeen(seenAt)}. You&apos;re all set.
                </p>
              </div>
            </div>
            <p className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">
              New phone, reinstalled the app, or the bubble asks you to re-link?{" "}
              <button
                type="button"
                onClick={linkAgain}
                className="font-medium text-foreground underline underline-offset-4 hover:opacity-80"
              >
                Create a new link
              </button>
            </p>
          </div>
        ) : (
          <LinkSteps>
            {!link ? (
              <PrimaryButton onClick={create} disabled={busy} className="w-full sm:w-auto">
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {busy ? "Creating…" : "Create link"}
              </PrimaryButton>
            ) : (
              <div className="space-y-3 animate-fade-up">
                {/* A button, not an <a href>: no "Copy link address" on long-press,
                    so the sign-in link can't be copied and passed to someone else. */}
                <PrimaryButton onClick={() => window.location.assign(link.deepLink)} className="w-full sm:w-auto">
                  <ExternalLink className="size-4" aria-hidden="true" />
                  Open in Bubble app
                </PrimaryButton>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Open this page on the phone that has the Bubble Chat app installed. Valid until {expiresAt}.
                </p>
              </div>
            )}
          </LinkSteps>
        )}
      </section>

      {error && (
        <p role="alert" className="mt-4 flex items-center gap-2 text-sm text-danger">
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      <section className="mt-6 rounded-2xl border border-border p-5">
        <div className="flex items-start gap-3">
          <Unlink className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="font-medium">Unlink all devices</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Signs out the bubble app and every browser where you&apos;re signed in, including this one.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {confirmUnlink ? (
                <>
                  <button
                    type="button"
                    onClick={unlinkAll}
                    disabled={unlinking}
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-danger px-5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {unlinking && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                    {unlinking ? "Signing out…" : "Yes, sign out everywhere"}
                  </button>
                  <SecondaryButton onClick={() => setConfirmUnlink(false)}>Cancel</SecondaryButton>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmUnlink(true)}
                  className="inline-flex h-10 items-center rounded-full border border-danger/40 px-5 text-sm font-medium text-danger transition-colors hover:bg-danger/5"
                >
                  Unlink all devices
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <Credit className="mt-10 text-center" />
    </main>
  );
}

function LinkSteps({ children }: { children: ReactNode }) {
  return (
    <>
      <ol className="space-y-4">
        <Step n={1}>Install the Bubble Chat app on this Android phone.</Step>
        <Step n={2}>Create a sign-in link below.</Step>
        <Step n={3}>
          Tap <strong className="font-medium">Open in Bubble app</strong>. The bubble signs in as you.
        </Step>
      </ol>
      <div className="mt-6 border-t border-border pt-5">{children}</div>
    </>
  );
}

/** "today at 3:58 PM", "yesterday at …", or "12 Oct at …". */
function formatSeen(date: Date): string {
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  return `${date.toLocaleDateString([], { day: "numeric", month: "short" })} at ${time}`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3 text-sm">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-semibold">
        {n}
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}
