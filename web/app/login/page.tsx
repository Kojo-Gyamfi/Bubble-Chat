"use client";

import { FirebaseError } from "firebase/app";
import { AlertCircle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { InstallApp } from "@/components/InstallApp";
import { SplashScreen } from "@/components/Spinner";
import { Credit, Logo } from "@/components/ui";
import { signInWithGoogle } from "@/lib/firebase/client";

export default function LoginPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) router.replace(safeNext(window.location.search));
  }, [user, router]);

  if (user !== null) return <SplashScreen />;

  async function handleSignIn() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : "";
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
        setError("Sign-in failed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="safe-area flex h-dvh flex-col items-center justify-center">
      <div className="flex w-full max-w-sm flex-col items-center text-center animate-fade-up">
        <Logo className="size-24" />
        <h1 className="mt-6 text-[26px] font-semibold tracking-tight">Welcome to Bubble</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">Your private AI chat. Sign in to continue.</p>

        <button
          type="button"
          onClick={handleSignIn}
          disabled={busy}
          className="mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-full border border-border bg-background text-[15px] font-medium transition-colors hover:bg-surface disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <GoogleIcon />}
          {busy ? "Signing in…" : "Continue with Google"}
        </button>

        {error && (
          <p role="alert" className="mt-4 flex items-center gap-2 text-sm text-danger">
            <AlertCircle className="size-4" aria-hidden="true" />
            {error}
          </p>
        )}

        <div className="mt-3 w-full">
          <InstallApp variant="page" />
        </div>

        <p className="mt-10 text-xs text-muted-foreground">Invite only. Access is limited to approved accounts.</p>
        <Credit className="mt-1.5" />
      </div>
    </main>
  );
}

/** `?next=` target; same-site paths only (no open redirect). */
function safeNext(search: string): string {
  const next = new URLSearchParams(search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
