"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
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
    setTimeout(() => setCopied(false), 1500);
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
    <main className="safe-area mx-auto flex min-h-dvh max-w-lg flex-col gap-8">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-sm underline opacity-70 hover:opacity-100">
          ← Back to chat
        </Link>
      </header>

      <section className="space-y-4">
        <h1 className="text-xl font-semibold">Link the bubble app</h1>
        <ol className="list-decimal space-y-1 pl-5 text-sm opacity-80">
          <li>Install the Bubble Chat app on this Android phone.</li>
          <li>Tap <strong>Create link</strong> below.</li>
          <li>Tap <strong>Open in Bubble app</strong>. The bubble signs in as you.</li>
        </ol>

        {!link ? (
          <button
            type="button"
            onClick={create}
            disabled={busy}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create link"}
          </button>
        ) : (
          <div className="space-y-3 rounded-xl border border-border bg-muted p-4">
            <a
              href={link.deepLink}
              className="block rounded-xl bg-accent px-4 py-3 text-center text-sm font-medium text-white"
            >
              Open in Bubble app
            </a>
            <button
              type="button"
              onClick={copy}
              className="w-full rounded-xl border border-border bg-background px-4 py-2 text-sm"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
            <p className="text-xs opacity-60">
              Valid until {expiresAt}. Don&apos;t share it: anyone with this link can use the chat as you.
            </p>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </section>

      <section className="space-y-3 border-t border-border pt-6">
        <h2 className="font-medium">Unlink all devices</h2>
        <p className="text-sm opacity-70">
          Signs out the bubble app and every browser where you&apos;re signed in, including this one.
        </p>
        {confirmUnlink ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={unlinkAll}
              disabled={unlinking}
              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {unlinking ? "Signing out…" : "Yes, sign out everywhere"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmUnlink(false)}
              className="rounded-xl border border-border px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmUnlink(true)}
            className="rounded-xl border border-red-600/40 px-4 py-2 text-sm text-red-700 dark:text-red-400"
          >
            Unlink all devices
          </button>
        )}
      </section>
    </main>
  );
}
