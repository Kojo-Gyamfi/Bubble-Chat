"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import { Settings } from "lucide-react";
import { Notice } from "@/components/ui";
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
    <Notice icon={Settings} title="Firebase isn't configured">
      Copy <code className="font-mono text-foreground">web/.env.example</code> to{" "}
      <code className="font-mono text-foreground">web/.env.local</code>, fill in the Firebase values and restart the dev
      server.
    </Notice>
  );
}
