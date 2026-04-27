import { describe, expect, it } from "vitest";
import { hashToken, prefixedId, safeTokenEquals, token } from "../src/ids.js";

describe("ID and token helpers", () => {
  it("generates non-enumerable prefixed ids", () => {
    const ids = new Set(Array.from({ length: 200 }, () => prefixedId("room")));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^room_[A-Za-z0-9_-]{22,}$/);
  });

  it("generates long bearer tokens", () => {
    expect(token()).toMatch(/^cacp_[A-Za-z0-9_-]{32,}$/);
  });

  it("hashes tokens without exposing plaintext", () => {
    const secret = "unit-test-secret-unit-test-secret";
    const value = "cacp_example_token";
    const hash = hashToken(value, secret);
    expect(hash).toMatch(/^hmac-sha256:/);
    expect(hash).not.toContain(value);
    expect(safeTokenEquals(value, hash, secret)).toBe(true);
    expect(safeTokenEquals("wrong", hash, secret)).toBe(false);
  });
});
