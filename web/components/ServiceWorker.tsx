"use client";

import { SerwistProvider } from "@serwist/turbopack/react";
import type { ReactNode } from "react";

export function ServiceWorker({ children }: { children: ReactNode }) {
  return (
    <SerwistProvider
      swUrl="/serwist/sw.js"
      // A dev SW only gets in the way of hot reload.
      disable={process.env.NODE_ENV === "development"}
      // Don't reload the page (and lose a half-typed message) on reconnect.
      reloadOnOnline={false}
    >
      {children}
    </SerwistProvider>
  );
}
