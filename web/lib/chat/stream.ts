import "server-only";

import { after } from "next/server";

const INTERRUPTED_NOTE = "\n\n_(response interrupted)_";

/**
 * Streams `source` to the client as plain text and calls `persist` with the
 * full text once the source is exhausted. The source is consumed to the end
 * even if the client disconnects, and `after()` keeps the function alive
 * until the result is saved.
 */
export function streamAndPersist(
  source: AsyncIterable<string>,
  persist: (text: string) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let clientOpen = true;

  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      clientOpen = false;
    },
  });

  const send = (chunk: string) => {
    if (!clientOpen) return;
    try {
      controller.enqueue(encoder.encode(chunk));
    } catch {
      clientOpen = false;
    }
  };

  const done = (async () => {
    let text = "";
    let failure: unknown = null;
    try {
      for await (const chunk of source) {
        text += chunk;
        send(chunk);
      }
    } catch (err) {
      failure = err;
      console.error("Reply generation failed", err);
    }

    if (failure && !text) {
      if (clientOpen) controller.error(failure);
      return;
    }
    if (failure) {
      text += INTERRUPTED_NOTE;
      send(INTERRUPTED_NOTE);
    }

    try {
      await persist(text);
    } catch (err) {
      console.error("Failed to save assistant message", err);
    }
    if (clientOpen) controller.close();
  })();

  after(done);

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
