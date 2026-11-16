import "server-only";

import { FILE_CLOSE, FILE_OPEN, FILE_TAG, type FileFormat, FORMAT_INFO, fileSpec, parseFileAttributes } from "@/lib/chat/file-blocks";
import type { ReplyStatus } from "@/lib/chat/status";

type Chunk = string | { status: ReplyStatus };

export interface FileMaker {
  /** Builds and stores the file; returns its download link. */
  make(file: { format: FileFormat; name: string; content: string }): Promise<{ href: string }>;
  /** The user pressed Stop: don't build a half-written file. */
  signal?: AbortSignal;
}

/** While a file is being written, repeat the status this often so the client knows we're alive. */
const KEEPALIVE_MS = 10_000;

/** How many characters at the end of `text` could be the start of `tag` (split across chunks). */
function partialTagLength(text: string, tag: string): number {
  for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
    if (tag.startsWith(text.slice(-n))) return n;
  }
  return 0;
}

function attr(value: string): string {
  return value.replace(/["<>]/g, "'");
}

/**
 * Turns `<bubble-file format="…" name="…">Markdown</bubble-file>` blocks in a
 * reply into real files. Text outside blocks streams through unchanged. A
 * block is held back (the client sees "Creating your file…") until it's
 * complete, then the file is built and saved, and the block is sent with its
 * download link (`href`). If building fails, the content is sent as normal
 * text with a note, so nothing is lost.
 */
export async function* withFiles(source: AsyncIterable<Chunk>, maker: FileMaker): AsyncGenerator<Chunk> {
  let pending = "";
  let block: { attrs: Record<string, string>; content: string } | null = null;
  let lastStatusAt = 0;

  const status = (): Chunk => {
    lastStatusAt = Date.now();
    return { status: "writing" };
  };

  async function* finish(current: { attrs: Record<string, string>; content: string }, cutOff: boolean): AsyncGenerator<Chunk> {
    const { format, name } = fileSpec(current.attrs);
    const content = current.content.trim();
    if (maker.signal?.aborted) {
      // Stopped while writing: keep what was written, as text.
      yield `\n\n${content}`;
      return;
    }
    try {
      const { href } = await maker.make({ format, name, content });
      yield `<${FILE_TAG} format="${format}" name="${attr(name)}" href="${attr(href)}">\n${content}\n${FILE_CLOSE}`;
      if (cutOff) yield "\n\n_(The reply was cut off, so the file may be incomplete.)_";
    } catch (err) {
      console.error(`Could not create the ${format} file`, err);
      yield `\n\n_(Sorry, I couldn't create the ${FORMAT_INFO[format].label} file. Here's the content instead:)_\n\n${content}`;
    }
  }

  for await (const chunk of source) {
    if (typeof chunk !== "string") {
      yield chunk;
      continue;
    }
    pending += chunk;
    for (;;) {
      if (!block) {
        const start = pending.indexOf(FILE_OPEN);
        if (start < 0) {
          // Keep a possible "<bubble-fi" at the end until the next chunk shows what it is.
          const keep = partialTagLength(pending, FILE_OPEN);
          const text = pending.slice(0, pending.length - keep);
          if (text) yield text;
          pending = pending.slice(pending.length - keep);
          break;
        }
        const end = pending.indexOf(">", start);
        if (end < 0) {
          // The opening tag isn't complete yet.
          if (start > 0) yield pending.slice(0, start);
          pending = pending.slice(start);
          break;
        }
        if (start > 0) yield pending.slice(0, start);
        block = { attrs: parseFileAttributes(pending.slice(start, end + 1)), content: "" };
        pending = pending.slice(end + 1);
        yield status();
        continue;
      }
      const close = pending.indexOf(FILE_CLOSE);
      if (close < 0) {
        const keep = partialTagLength(pending, FILE_CLOSE);
        block.content += pending.slice(0, pending.length - keep);
        pending = pending.slice(pending.length - keep);
        if (Date.now() - lastStatusAt >= KEEPALIVE_MS) yield status();
        break;
      }
      block.content += pending.slice(0, close);
      pending = pending.slice(close + FILE_CLOSE.length);
      yield* finish(block, false);
      block = null;
    }
  }

  if (block) {
    // The reply ended inside a file (cut off at the length limit, or stopped).
    block.content += pending;
    yield* finish(block, true);
  } else if (pending) {
    yield pending;
  }
}
