"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Notice, PrimaryButton } from "@/components/ui";

/** Any unexpected render error: show a way back instead of a blank screen. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Notice
      icon={TriangleAlert}
      tone="danger"
      title="Something went wrong"
      action={
        <PrimaryButton onClick={() => (navigator.onLine ? reset() : window.location.reload())}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Try again
        </PrimaryButton>
      }
    >
      Bubble hit an unexpected error. Your conversations are safe.
    </Notice>
  );
}
