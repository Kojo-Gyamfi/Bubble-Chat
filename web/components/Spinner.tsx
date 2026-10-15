import { Loader2 } from "lucide-react";

export function FullScreenSpinner() {
  return (
    <div className="flex h-dvh items-center justify-center text-muted-foreground" role="status" aria-label="Loading">
      <Loader2 className="size-6 animate-spin" aria-hidden="true" />
    </div>
  );
}
