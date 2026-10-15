import type { Conversation } from "@/lib/chat/schema";

export interface ConversationGroup {
  label: string;
  items: Conversation[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** ChatGPT-style sidebar sections. Input is assumed newest-first. */
export function groupByDate(conversations: Conversation[], now = new Date()): ConversationGroup[] {
  const today = startOfDay(now);
  const buckets: [string, (t: number) => boolean][] = [
    ["Today", (t) => t >= today],
    ["Yesterday", (t) => t >= today - DAY_MS],
    ["Previous 7 days", (t) => t >= today - 7 * DAY_MS],
    ["Previous 30 days", (t) => t >= today - 30 * DAY_MS],
    ["Older", () => true],
  ];

  const groups: ConversationGroup[] = [];
  for (const c of conversations) {
    // A just-created conversation may not have its server timestamp yet.
    const t = c.updatedAt?.getTime() ?? now.getTime();
    const label = buckets.find(([, test]) => test(t))![0];
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(c);
    else groups.push({ label, items: [c] });
  }
  return groups;
}
