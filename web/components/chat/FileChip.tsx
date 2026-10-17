import { FileText } from "lucide-react";
import type { ReactNode } from "react";
import { fileKind, formatSize } from "@/lib/chat/files";
import type { FileInfo } from "@/lib/chat/schema";

/** An attached document: icon, name, type and size. */
export function FileChip({ info, children }: { info: FileInfo; children?: ReactNode }) {
  return (
    <div className="relative flex max-w-full min-w-0 items-center gap-2.5 rounded-xl border border-border bg-background py-2 pr-3 pl-2 dark:bg-surface-strong">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand text-white">
        <FileText className="size-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{info.name}</span>
        <span className="block text-xs text-muted-foreground">
          {fileKind(info)} · {formatSize(info.size)}
        </span>
      </span>
      {children}
    </div>
  );
}
