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

describe("streamAndPersist when the client stops", () => {
  async function* slow(parts: string[], signal: AbortSignal) {
    for (const part of parts) {
      await new Promise((r) => setTimeout(r, 5));
      signal.throwIfAborted();
      yield part;
    }
  }

  it("ends generation and saves the partial reply marked stopped", async () => {
    const persist = vi.fn(async () => {});
    const stop = new AbortController();
    const res = await streamAndPersist(slow(["One ", "two ", "three ", "four"], stop.signal), persist, { stop });
    const reader = res.body!.getReader();
    await reader.read(); // "One "
    await reader.cancel(); // Stop button / page closed
    await Promise.all(pending);
    expect(stop.signal.aborted).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
    const saved = (persist.mock.calls[0] as unknown as [string])[0];
    expect(saved).toMatch(/^One[\s\S]*_\(stopped\)_$/);
    expect(saved).not.toContain("four");
    expect(saved).not.toContain("interrupted");
  });

  it("passes extra headers through", async () => {
    const res = await streamAndPersist(chunks(["hi"]), async () => {}, { headers: { "X-Messages-Left": "7" } });
    expect(res.headers.get("X-Messages-Left")).toBe("7");
    await res.text();
  });
});
