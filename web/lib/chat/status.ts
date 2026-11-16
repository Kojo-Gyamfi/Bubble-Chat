/**
 * What the AI is doing before (or between parts of) its answer, e.g. searching
 * the web. Sent inside the plain-text reply stream as a small marker that is
 * never saved: the server writes it, the client strips it and shows a label.
 */
export type ReplyStatus = "working" | "searching" | "reading" | "writing";

export const STATUS_LABEL: Record<ReplyStatus, string> = {
  working: "Looking it up…",
  searching: "Searching the web…",
  reading: "Reading the page…",
  writing: "Creating your file…",
};

// ASCII record / unit separators: never part of normal text.
const START = "\u001E";
const END = "\u001F";
const MARKER = /\u001E([a-z]*)\u001F/g;
const CUT_OFF_MARKER = /\u001E[^\u001F]*$/;

function isStatus(value: string): value is ReplyStatus {
  return Object.hasOwn(STATUS_LABEL, value);
}

export function encodeStatus(status: ReplyStatus): string {
  return `${START}${status}${END}`;
}

/**
 * Splits the raw streamed reply into its text and the current status. A status
 * stays current until more reply text arrives after it.
 */
export function parseReplyStream(raw: string): { text: string; status: ReplyStatus | null } {
  // A marker split across two network chunks: wait for the rest of it.
  const complete = raw.replace(CUT_OFF_MARKER, "");
  let text = "";
  let status: ReplyStatus | null = null;
  let last = 0;
  for (const match of complete.matchAll(MARKER)) {
    const before = complete.slice(last, match.index);
    text += before;
    if (before.trim()) status = null;
    if (isStatus(match[1])) status = match[1];
    last = match.index + match[0].length;
  }
  const rest = complete.slice(last);
  text += rest;
  if (rest.trim()) status = null;
  return { text, status };
}
