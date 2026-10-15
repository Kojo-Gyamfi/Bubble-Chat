"use client";

import { Check, Copy, type LucideIcon } from "lucide-react";
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef, useState } from "react";
import { bridge } from "@/lib/bridge";

/** Brand mark: blue rounded square with a chat bubble (matches the app icon). */
export function Logo({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <rect width="100" height="100" rx="24" fill="#2563eb" />
      <path fill="#fff" d="M50 20a27 27 0 1 1-14.2 50L25 79l6-19.5A27 27 0 0 1 50 20z" />
      <g fill="#2563eb">
        <circle cx="39" cy="47" r="3.8" />
        <circle cx="50" cy="47" r="3.8" />
        <circle cx="61" cy="47" r="3.8" />
      </g>
    </svg>
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
  size?: "sm" | "md";
};

/** Square ghost button with an icon; `label` doubles as tooltip and aria-label. */
export function IconButton({ icon: Icon, label, size = "md", className = "", ...props }: IconButtonProps) {
  const box = size === "sm" ? "size-8" : "size-9";
  const glyph = size === "sm" ? "size-4" : "size-5";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex ${box} shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-40 ${className}`}
      {...props}
    >
      <Icon className={glyph} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

/** Copy-to-clipboard icon that flips to a check mark. Uses the native bridge in the bubble. */
export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    if (!(await bridge.copyText(text))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <IconButton
      icon={copied ? Check : Copy}
      label={copied ? "Copied" : label}
      size="sm"
      onClick={copy}
      className={className}
    />
  );
}

/** Full-screen centered message (offline, not allowed, re-link, …). */
export function Notice({
  icon: Icon,
  tone = "neutral",
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  tone?: "neutral" | "danger";
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <main className="safe-area flex h-dvh items-center justify-center">
      <div className="flex max-w-sm flex-col items-center text-center animate-fade-up">
        <div
          className={`mb-4 flex size-12 items-center justify-center rounded-full ${
            tone === "danger" ? "bg-danger/10 text-danger" : "bg-surface text-foreground"
          }`}
        >
          <Icon className="size-6" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <div className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{children}</div>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </main>
  );
}

export function PrimaryButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-85 disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}

export function SecondaryButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-full border border-border bg-background px-5 text-sm font-medium transition-colors hover:bg-surface disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}
