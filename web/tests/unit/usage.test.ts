import { afterEach, describe, expect, it, vi } from "vitest";
import { checkLimits, dayKey, limitMessage, limitsFromEnv } from "@/lib/usage";

const limits = { perUser: 25, global: 200 };

describe("checkLimits", () => {
  it("allows requests under both caps", () => {
    expect(checkLimits(0, 0, limits)).toEqual({ ok: true, remaining: 24 });
    expect(checkLimits(24, 199, limits)).toEqual({ ok: true, remaining: 0 });
  });

  it("blocks the request after the per-user cap", () => {
    expect(checkLimits(25, 0, limits)).toEqual({ ok: false, scope: "user", limit: 25 });
  });

  it("blocks everyone once the global cap is hit", () => {
    expect(checkLimits(0, 200, limits)).toEqual({ ok: false, scope: "global", limit: 200 });
  });
});

describe("limitMessage", () => {
  it("mentions the per-user limit", () => {
    expect(limitMessage({ ok: false, scope: "user", limit: 25 })).toContain("25");
  });
});

describe("dayKey", () => {
  it("uses the UTC date", () => {
    expect(dayKey(new Date("2026-10-14T23:59:59Z"))).toBe("2026-10-14");
    expect(dayKey(new Date("2026-10-15T00:00:00Z"))).toBe("2026-10-15");
  });
});

describe("limitsFromEnv", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads the env vars", () => {
    vi.stubEnv("DAILY_REQUEST_LIMIT", "10");
    vi.stubEnv("GLOBAL_DAILY_REQUEST_LIMIT", "50");
    expect(limitsFromEnv()).toEqual({ perUser: 10, global: 50 });
  });

  it("falls back to defaults on missing or invalid values", () => {
    vi.stubEnv("DAILY_REQUEST_LIMIT", "");
    vi.stubEnv("GLOBAL_DAILY_REQUEST_LIMIT", "abc");
    expect(limitsFromEnv()).toEqual({ perUser: 25, global: 200 });
  });
});
