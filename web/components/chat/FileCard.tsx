"use client";

import { Download, FileSpreadsheet, FileText, type LucideIcon, Presentation } from "lucide-react";
import { type FileFormat, fileNameOf, FORMAT_INFO, type ReplyPart } from "@/lib/chat/file-blocks";
import { bridge } from "@/lib/bridge";

const LOOK: Record<FileFormat, { icon: LucideIcon; tile: string }> = {
  docx: { icon: FileText, tile: "bg-blue-500/12 text-blue-600 dark:text-blue-400" },
  pdf: { icon: FileText, tile: "bg-red-500/12 text-red-600 dark:text-red-400" },
  xlsx: { icon: FileSpreadsheet, tile: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" },
  pptx: { icon: Presentation, tile: "bg-orange-500/12 text-orange-600 dark:text-orange-400" },
};

/** A file the AI created: name, type and a Download button. */
export function FileCard({ file }: { file: Extract<ReplyPart, { type: "file" }> }) {
  const { icon: Icon, tile } = LOOK[file.format];
  const fileName = fileNameOf(file);
  const ready = file.complete && !!file.href;

  return (
    <div className="my-3 flex items-center gap-3 rounded-2xl border border-border bg-surface px-3.5 py-3 animate-fade-up">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${tile}`}>
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium" title={fileName}>
          {fileName}
        </div>
        <div className="text-xs text-muted-foreground">{FORMAT_INFO[file.format].label}</div>
      </div>
      {ready ? (
        <a
          href={file.href}
          download={fileName}
          onClick={(e) => {
            // The bubble's WebView can't download: hand the link to the real browser.
            if (bridge.isNative()) {
              e.preventDefault();
              bridge.openInBrowser(file.href!);
            }
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Download className="size-4" aria-hidden="true" />
          Download
        </a>
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">Not available</span>
      )}
    </div>
  );
}
