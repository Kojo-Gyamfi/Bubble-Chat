import "server-only";

// Phase 1 stand-in for the LLM: streams a canned markdown reply word by word.
export async function* mockReply(message: string): AsyncIterable<string> {
  const quoted = message.length > 200 ? `${message.slice(0, 200)}…` : message;
  const reply = [
    "This is a **mocked** reply. The real model gets wired up in Phase 2.",
    "",
    `> ${quoted.replace(/\n/g, "\n> ")}`,
    "",
    "Things that already work:",
    "",
    "- streaming, chunk by chunk",
    "- markdown rendering, including `inline code`",
    "- history saved to Firestore by the server",
    "",
    "```ts",
    'console.log("hello from the bubble");',
    "```",
  ].join("\n");

  for (const token of reply.split(/(?<=\s)/)) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    yield token;
  }
}
