"use client";

import { SerwistProvider } from "@serwist/turbopack/react";
import { type ReactNode, useState } from "react";

export function ServiceWorker({ children }: { children: ReactNode }) {
  // Inside the bubble's WebView the offline cache isn't useful, and precaching
  // (~1.5 MB) would download in the background over mobile data on first launch.
  const [inBubble] = useState(() => typeof window !== "undefined" && window.Android !== undefined);

  return (
    <SerwistProvider
      swUrl="/serwist/sw.js"
      // A dev SW only gets in the way of hot reload.
      disable={process.env.NODE_ENV === "development" || inBubble}
      // Don't reload the page (and lose a half-typed message) on reconnect.
      reloadOnOnline={false}
    >
      {children}
    </SerwistProvider>
  );
}
