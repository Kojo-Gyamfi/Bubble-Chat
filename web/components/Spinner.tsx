import { Loader2 } from "lucide-react";
import { Logo } from "@/components/ui";

export function FullScreenSpinner() {
  return (
    <div className="flex h-dvh items-center justify-center text-muted-foreground" role="status" aria-label="Loading">
      <Loader2 className="size-6 animate-spin" aria-hidden="true" />
    </div>
  );
}

/** Launch screen while the session loads. Navy matches the icon background (and manifest background_color). */
export function SplashScreen() {
  return (
    <div
      className="flex h-dvh flex-col items-center bg-[#0f1035] px-6 pt-[env(safe-area-inset-top)] pb-[calc(env(safe-area-inset-bottom)+1.5rem)] text-white"
      role="status"
      aria-label="Loading"
    >
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <Logo className="size-28" />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Bubble</h1>
        <p className="mt-1 text-sm text-white/70">Your personal AI chat assistant</p>
        <Loader2 className="mt-8 size-5 animate-spin text-white/50" aria-hidden="true" />
      </div>
      <p className="text-xs text-white/50">Built by Nana Kojo</p>
    </div>
  );
}
