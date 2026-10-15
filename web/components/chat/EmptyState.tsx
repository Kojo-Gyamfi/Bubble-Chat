"use client";

import { Code2, Lightbulb, PenLine, Plane } from "lucide-react";
import { Logo } from "@/components/ui";

// Each chip starts the sentence; the user finishes it in the composer.
const SUGGESTIONS = [
  { icon: Lightbulb, label: "Explain something", starter: "Explain " },
  { icon: Plane, label: "Plan a trip", starter: "Plan a trip to " },
  { icon: PenLine, label: "Help me write", starter: "Help me write " },
  { icon: Code2, label: "Code help", starter: "Help me with this code: " },
];

/** New-chat welcome: greeting plus a few conversation starters. */
export function EmptyState({
  name,
  onStart,
  compact = false,
}: {
  name?: string | null;
  /** Called with the starter text to put in the composer (not sent). */
  onStart?: (starter: string) => void;
  compact?: boolean;
}) {
  const first = name?.trim().split(/\s+/)[0];

  if (compact) {
    return (
      <div className="flex flex-col items-center gap-3 text-center animate-fade-in">
        <Logo className="size-9" />
        <p className="text-lg font-semibold tracking-tight">How can I help?</p>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-2xl flex-col items-center gap-7 text-center animate-fade-in">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
        {first ? `What can I help with, ${first}?` : "What can I help with?"}
      </h2>
      {onStart && (
        <div className="flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map(({ icon: Icon, label, starter }) => (
            <button
              key={label}
              type="button"
              onClick={() => onStart(starter)}
              className="flex items-center gap-2 rounded-full border border-border px-3.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
