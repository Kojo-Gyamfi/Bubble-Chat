"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { bridge } from "@/lib/bridge";

// No rehype-raw: model output is never rendered as raw HTML.
const components: Components = {
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

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
