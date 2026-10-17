import "server-only";

import { after } from "next/server";

const INTERRUPTED_NOTE = "\n\n_(response interrupted)_";
const STOPPED_NOTE = "\n\n_(stopped)_";
const EMPTY_NOTE = "_(no response; try rephrasing)_";
const UNAVAILABLE = "The AI service is busy or unavailable right now. Please try again in a minute.";

export interface StreamOptions {
  /**
   * Aborted when the client goes away (Stop button, closed page, dropped
   * connection). The model call should listen to it; whatever was written so
   * far is saved with a "stopped" note.
   */
  stop?: AbortController;
  /** Extra response headers (e.g. messages left today). */
  headers?: Record<string, string>;
}

/**
 * Streams `source` to the client as plain text and calls `persist` with the
 * text once the source ends, and `after()` keeps the function alive until it
 * is saved. If the client disconnects, `stop` is aborted so generation ends
 * early and the partial reply is saved.
 *
 * Waits for the first chunk before responding, so a reply that fails outright
 * (every provider down or rate-limited) becomes a 503 with a readable message
 * instead of a broken stream.
 */
export async function streamAndPersist(
  source: AsyncIterable<string>,
  persist: (text: string) => Promise<void>,
  { stop, headers }: StreamOptions = {},
): Promise<Response> {
  const stopped = () => stop?.signal.aborted === true;
  const save = (text: string) =>
    persist(text).catch((err) => console.error("Failed to save assistant message", err));

  const iterator = source[Symbol.asyncIterator]();
  let first: IteratorResult<string>;
  try {
    first = await iterator.next();
  } catch (err) {
    if (stopped()) {
      // Stopped before the first word: keep the turn in history anyway.
      after(save(STOPPED_NOTE.trim()));
      return new Response(null, { status: 204 });
    }
    console.error("Reply generation failed", err);
    return Response.json({ error: UNAVAILABLE }, { status: 503 });
  }

  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let clientOpen = true;
  const clientGone = () => {
    clientOpen = false;
    stop?.abort();
  };

  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel: clientGone,
  });

  const send = (chunk: string) => {
    if (!clientOpen) return;
    try {
      controller.enqueue(encoder.encode(chunk));
    } catch {
      clientGone();
    }
  };

  const done = (async () => {
    let text = "";
    try {
      for (let next = first; !next.done; next = await iterator.next()) {
        text += next.value;
        send(next.value);
        if (stopped()) {
          await iterator.return?.();
          break;
        }
      }
    } catch (err) {
      if (!stopped()) {
        console.error("Reply generation failed mid-stream", err);
        text += INTERRUPTED_NOTE;
        send(INTERRUPTED_NOTE);
      }
    }
    if (stopped()) text = `${text.trimEnd()}${STOPPED_NOTE}`.trimStart();
    if (!text.trim()) {
      text = EMPTY_NOTE;
      send(EMPTY_NOTE);
    }

    await save(text);
    if (clientOpen) controller.close();
  })();

  after(done);

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}
