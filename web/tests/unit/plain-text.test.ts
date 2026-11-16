import { describe, expect, it } from "vitest";
import { messagePlainText } from "@/lib/chat/plain-text";

describe("messagePlainText", () => {
  it("drops formatting marks but keeps every word", () => {
    const md = "## Facts\n\nHere are facts about **Kumasi** and *Accra*, ~~not~~ `code`.\n\n> A quote";
    expect(messagePlainText(md)).toBe("Facts\n\nHere are facts about Kumasi and Accra, not code.\n\nA quote");
  });

  it("keeps list numbers, turns bullets into dots and links into text (address)", () => {
    const md = "1. First\n2. Second\n\n- one\n  - nested\n- [ ] todo\n- [x] done\n\nSee [the site](https://example.com) or https://a.test";
    expect(messagePlainText(md)).toBe(
      "1. First\n2. Second\n\n• one\n  • nested\n☐ todo\n☑ done\n\nSee the site (https://example.com) or https://a.test",
    );
  });

  it("keeps code blocks' code and table cells", () => {
    const md = "```ts\nconst a = 1;\n```\n\n| Item | Cost |\n| --- | ---: |\n| Bus | 120 |";
    expect(messagePlainText(md)).toBe("const a = 1;\n\nItem  |  Cost\nBus  |  120");
  });

  it("shows a created file's content instead of the block", () => {
    const md = 'Here it is.\n<bubble-file format="docx" name="Plan" href="https://x.test">\n# Plan\n\n- Day 1\n</bubble-file>';
    expect(messagePlainText(md)).toBe("Here it is.\n\nPlan\n\n• Day 1");
  });

  it("leaves plain text (e.g. the user's own message) alone", () => {
    expect(messagePlainText("What's 2*3 and 4*5? snake_case_name")).toBe("What's 2*3 and 4*5? snake_case_name");
  });
});
