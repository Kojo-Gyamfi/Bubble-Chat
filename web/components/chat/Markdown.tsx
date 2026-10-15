"use client";

import { Check, Copy } from "lucide-react";
import { isValidElement, memo, type ReactNode, useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { bridge } from "@/lib/bridge";

function CodeBlock({ language, code }: { language?: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    if (!(await bridge.copyText(code))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="code-block">
      <div className="flex items-center justify-between bg-[var(--code-header)] px-4 py-1.5 text-xs text-neutral-300">
        <span className="font-mono lowercase">{language ?? "code"}</span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 rounded px-1.5 py-1 transition-colors hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
          {copied ? "Copied" : "Copy code"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

// No rehype-raw: model output is never rendered as raw HTML.
const components: Components = {
  pre: ({ children }) => {
    const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : null;
    const language = /language-([\w+#-]+)/.exec(code?.props.className ?? "")?.[1];
    return <CodeBlock language={language} code={textOf(code?.props.children ?? children).replace(/\n$/, "")} />;
  },
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        // In the bubble WebView, links must open in the real browser; the
        // WebView itself never leaves our domain (it holds the bridge).
        if (href && bridge.isNative()) {
          e.preventDefault();
          bridge.openInBrowser(href);
        }
      }}
    >
      {children}
    </a>
  ),
};

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
});
