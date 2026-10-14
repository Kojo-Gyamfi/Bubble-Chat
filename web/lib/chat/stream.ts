import "server-only";

import { after } from "next/server";

const INTERRUPTED_NOTE = "\n\n_(response interrupted)_";
const EMPTY_NOTE = "_(no response; try rephrasing)_";
const UNAVAILABLE = "The AI service is busy or unavailable right now. Please try again in a minute.";

/**
 * Streams `source` to the client as plain text and calls `persist` with the
 * full text once the source is exhausted. The source is consumed to the end
 * even if the client disconnects, and `after()` keeps the function alive
 * until the result is saved.
 *
 * Waits for the first chunk before responding, so a reply that fails outright
 * (every provider down or rate-limited) becomes a 503 with a readable message
 * instead of a broken stream.
 */
export async function streamAndPersist(
  source: AsyncIterable<string>,
  persist: (text: string) => Promise<void>,
): Promise<Response> {
  const iterator = source[Symbol.asyncIterator]();
  let first: IteratorResult<string>;
  try {
    first = await iterator.next();
  } catch (err) {
    console.error("Reply generation failed", err);
    return Response.json({ error: UNAVAILABLE }, { status: 503 });
  }

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
    try {
      for (let next = first; !next.done; next = await iterator.next()) {
        text += next.value;
        send(next.value);
      }
    } catch (err) {
      console.error("Reply generation failed mid-stream", err);
      text += INTERRUPTED_NOTE;
      send(INTERRUPTED_NOTE);
    }
    if (!text.trim()) {
      text = EMPTY_NOTE;
      send(EMPTY_NOTE);
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
