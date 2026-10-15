import { describe, expect, it } from "vitest";
import { groupByDate } from "@/lib/chat/group";
import type { Conversation } from "@/lib/chat/schema";

const now = new Date(2026, 9, 15, 10, 0); // 15 Oct 2026, 10:00 local
const conv = (id: string, updatedAt: Date | null): Conversation => ({ id, title: id, updatedAt, messageCount: 2 });

describe("groupByDate", () => {
  it("buckets conversations into ChatGPT-style sections", () => {
    const groups = groupByDate(
      [
        conv("pending", null),
        conv("this-morning", new Date(2026, 9, 15, 8, 0)),
        conv("last-night", new Date(2026, 9, 14, 23, 0)),
        conv("monday", new Date(2026, 9, 12, 9, 0)),
        conv("last-month", new Date(2026, 8, 20)),
        conv("ancient", new Date(2025, 0, 1)),
      ],
      now,
    );
    expect(groups.map((g) => [g.label, g.items.map((c) => c.id)])).toEqual([
      ["Today", ["pending", "this-morning"]],
      ["Yesterday", ["last-night"]],
      ["Previous 7 days", ["monday"]],
      ["Previous 30 days", ["last-month"]],
      ["Older", ["ancient"]],
    ]);
  });

  it("returns no groups for no conversations", () => {
    expect(groupByDate([], now)).toEqual([]);
  });
});
