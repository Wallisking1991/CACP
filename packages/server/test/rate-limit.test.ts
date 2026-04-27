import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "../src/rate-limit.js";

describe("FixedWindowRateLimiter", () => {
  it("allows only the configured count per window", () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 1000, limit: 2 });
    expect(limiter.allow("ip:a", 0)).toBe(true);
    expect(limiter.allow("ip:a", 10)).toBe(true);
    expect(limiter.allow("ip:a", 20)).toBe(false);
    expect(limiter.allow("ip:a", 1001)).toBe(true);
  });
});
