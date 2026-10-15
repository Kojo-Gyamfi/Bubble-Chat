"use client";

import { Check, Copy, type LucideIcon } from "lucide-react";
import Image from "next/image";
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef, useState } from "react";
import { bridge } from "@/lib/bridge";

/** Brand mark: the robot chat bubble (public/brand/logo-mark.png, transparent, 512×512). */
export function Logo({ className = "size-7" }: { className?: string }) {
  return (
    <Image
      src="/brand/logo-mark.png"
      alt=""
      width={512}
      height={512}
      unoptimized
      priority
      className={`shrink-0 object-contain ${className}`}
    />
  );
}

/** Small "Built by Nana Kojo" credit line. */
export function Credit({ className = "" }: { className?: string }) {
  return <p className={`text-xs text-muted-foreground ${className}`}>Built by Nana Kojo</p>;
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
