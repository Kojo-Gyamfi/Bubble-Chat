"use client";

import { AlertCircle, ArrowLeft, Check, Copy, ExternalLink, Loader2, Smartphone, Unlink } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { Credit, PrimaryButton, SecondaryButton } from "@/components/ui";
import { bridge } from "@/lib/bridge";
import { createDeviceLink, type DeviceLink, revokeAllSessions } from "@/lib/chat/client";
import { friendlyError } from "@/lib/chat/hooks";
import { signOut } from "@/lib/firebase/client";

export default function LinkBubblePage() {
  const { user } = useAuth();
  const [link, setLink] = useState<DeviceLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  if (!user) return null; // the (app) layout handles signed-out users

  async function create() {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      setLink(await createDeviceLink(user));
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    setCopied(await bridge.copyText(link.deepLink));
    setTimeout(() => setCopied(false), 2000);
  }

  async function unlinkAll() {
    if (!user) return;
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
        <ol className="space-y-4">
          <Step n={1}>Install the Bubble Chat app on this Android phone.</Step>
          <Step n={2}>Create a sign-in link below.</Step>
          <Step n={3}>Tap <strong className="font-medium">Open in Bubble app</strong>. The bubble signs in as you.</Step>
        </ol>

        <div className="mt-6 border-t border-border pt-5">
          {!link ? (
            <PrimaryButton onClick={create} disabled={busy} className="w-full sm:w-auto">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {busy ? "Creating…" : "Create link"}
            </PrimaryButton>
          ) : (
            <div className="space-y-3 animate-fade-up">
              <div className="flex flex-col gap-2 sm:flex-row">
                <a
                  href={link.deepLink}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-primary sm:flex-1 px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-85"
                >
                  <ExternalLink className="size-4" aria-hidden="true" />
                  Open in Bubble app
                </a>
                <SecondaryButton onClick={copy} className="sm:flex-1">
                  {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
                  {copied ? "Copied" : "Copy link"}
                </SecondaryButton>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Valid until {expiresAt}. Don&apos;t share it: anyone with this link can use the chat as you.
              </p>
            </div>
          )}
        </div>
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
