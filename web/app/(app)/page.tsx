"use client";

import { useAuth } from "@/components/AuthProvider";
import { signOut } from "@/lib/firebase/client";

export default function ChatPage() {
  const { user } = useAuth();
  return (
    <main className="safe-area flex h-dvh flex-col items-center justify-center gap-4">
      <p>Signed in as {user?.email}</p>
      <button type="button" onClick={() => signOut()} className="underline">
        Sign out
      </button>
    </main>
  );
}
