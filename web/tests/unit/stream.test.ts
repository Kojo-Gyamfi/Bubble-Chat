import { beforeEach, describe, expect, it, vi } from "vitest";

const pending: Promise<unknown>[] = [];
vi.mock("next/server", () => ({ after: (p: Promise<unknown>) => pending.push(p) }));

const { streamAndPersist } = await import("@/lib/chat/stream");

async function* chunks(parts: string[], failAt?: number) {
  for (const [i, part] of parts.entries()) {
    if (i === failAt) throw new Error("provider failed");
    yield part;
  }
}

beforeEach(() => {
  pending.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("streamAndPersist", () => {
  it("streams the text and persists it in full", async () => {
    const persist = vi.fn(async () => {});
    const res = await streamAndPersist(chunks(["Hello", " world"]), persist);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Hello world");
    await Promise.all(pending);
    expect(persist).toHaveBeenCalledWith("Hello world");
  });

  it("returns 503 (and saves nothing) when the reply fails before any text", async () => {
    const persist = vi.fn(async () => {});
    const res = await streamAndPersist(chunks(["x"], 0), persist);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/try again/i);
    expect(persist).not.toHaveBeenCalled();
  });

  it("keeps partial text and marks it interrupted on a mid-stream failure", async () => {
    const persist = vi.fn(async () => {});
    const res = await streamAndPersist(chunks(["Partial", "never"], 1), persist);
    expect(await res.text()).toContain("Partial");
    await Promise.all(pending);
    expect(persist).toHaveBeenCalledWith(expect.stringMatching(/^Partial[\s\S]*interrupted/));
  });

  it("persists a placeholder instead of an empty reply", async () => {
    const persist = vi.fn(async () => {});
    const res = await streamAndPersist(chunks([]), persist);
    await res.text();
    await Promise.all(pending);
    expect(persist).toHaveBeenCalledWith(expect.stringContaining("no response"));
  });
});
