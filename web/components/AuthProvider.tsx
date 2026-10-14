"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { auth, isFirebaseConfigured } from "@/lib/firebase/client";

// undefined = still resolving, null = signed out
type AuthState = { user: User | null | undefined };

const AuthContext = createContext<AuthState>({ user: undefined });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  if (!isFirebaseConfigured) return <NotConfigured />;

  return <AuthContext.Provider value={{ user }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

function NotConfigured() {
  return (
    <main className="flex h-dvh items-center justify-center p-6 text-center">
      <div className="max-w-sm space-y-2">
        <h1 className="text-lg font-semibold">Firebase isn&apos;t configured</h1>
        <p className="text-sm opacity-70">
          Copy <code>web/.env.example</code> to <code>web/.env.local</code>, fill in the Firebase
          values and restart the dev server.
        </p>
      </div>
    </main>
  );
}
