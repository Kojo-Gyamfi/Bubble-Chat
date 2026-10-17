import "server-only";

// LLM_PROVIDER=mock: streams a canned markdown reply word by word, covering
// the common formatting so the UI can be checked without an API key.
// MOCK_TOKEN_DELAY_MS slows it down (e.g. to test the Stop button).
export async function* mockReply(
  message: string,
  { image = false, documents = [], signal }: { image?: boolean; documents?: string[]; signal?: AbortSignal } = {},
): AsyncIterable<string> {
  const quoted = message.length > 200 ? `${message.slice(0, 200)}…` : message;
  const delay = Number(process.env.MOCK_TOKEN_DELAY_MS) || 20;
  const reply = [
    "This is a **mocked** reply (`LLM_PROVIDER=mock`). You asked:",
    ...(image ? ["", "📷 I can see the photo you attached (mock)."] : []),
    ...(documents.length ? ["", `📄 I can read: ${documents.join(", ")} (mock).`] : []),
    "",
    `> ${quoted.replace(/\n/g, "\n> ")}`,
    "",
    "### What this checks",
    "",
    "1. Streaming, chunk by chunk",
    "2. Markdown: **bold**, *italic*, `inline code` and [links](https://nextjs.org)",
    "3. History saved to Firestore by the server",
    "",
    "| Feature | Status |",
    "| --- | --- |",
    "| Streaming | Working |",
    "| Copy buttons | Working |",
    "",
    "```ts",
    'const greeting = "hello from the bubble";',
    "console.log(greeting);",
    "```",
  ].join("\n");

  for (const token of reply.split(/(?<=\s)/)) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    signal?.throwIfAborted();
    yield token;
  }
}
