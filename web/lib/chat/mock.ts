import "server-only";

// LLM_PROVIDER=mock: streams a canned markdown reply word by word, covering
// the common formatting so the UI can be checked without an API key.
export async function* mockReply(message: string): AsyncIterable<string> {
  const quoted = message.length > 200 ? `${message.slice(0, 200)}…` : message;
  const reply = [
    "This is a **mocked** reply (`LLM_PROVIDER=mock`). You asked:",
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
    await new Promise((resolve) => setTimeout(resolve, 20));
    yield token;
  }
}
