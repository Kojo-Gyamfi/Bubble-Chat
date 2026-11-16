import { describe, expect, it } from "vitest";
import { encodeStatus, parseReplyStream } from "@/lib/chat/status";

const searching = encodeStatus("searching");
const reading = encodeStatus("reading");

describe("parseReplyStream", () => {
  it("passes plain text through", () => {
    expect(parseReplyStream("Hello there")).toEqual({ text: "Hello there", status: null });
  });

  it("shows the latest status until reply text arrives after it", () => {
    expect(parseReplyStream(searching)).toEqual({ text: "", status: "searching" });
    expect(parseReplyStream(`${searching}${reading}`)).toEqual({ text: "", status: "reading" });
    expect(parseReplyStream(`${searching}It's sunny`)).toEqual({ text: "It's sunny", status: null });
  });

  it("keeps the text around a status in the middle of a reply", () => {
    expect(parseReplyStream(`First part. ${searching}`)).toEqual({ text: "First part. ", status: "searching" });
    expect(parseReplyStream(`First part. ${searching}Second.`)).toEqual({ text: "First part. Second.", status: null });
  });

  it("waits for the rest of a marker split across network chunks", () => {
    const raw = `Hi${searching.slice(0, 3)}`;
    expect(parseReplyStream(raw)).toEqual({ text: "Hi", status: null });
    expect(parseReplyStream(`${raw}${searching.slice(3)}`)).toEqual({ text: "Hi", status: "searching" });
  });

  it("ignores unknown statuses (e.g. from a newer server)", () => {
    expect(parseReplyStream(`\u001Edancing\u001FHi`)).toEqual({ text: "Hi", status: null });
    expect(parseReplyStream(`\u001Edancing\u001F`)).toEqual({ text: "", status: null });
  });
});
