import { describe, expect, it } from "vitest";
import { buildConnectionCode, parseConnectionCode } from "../src/connection-code.js";
import { EventTypeSchema } from "../src/schemas.js";

describe("connection code", () => {
  it("round-trips a pairing payload", () => {
    const payload = {
      server_url: "https://cacp.example.com",
      pairing_token: "cacp_pairing_secret",
      expires_at: "2026-04-27T08:15:00.000Z",
      room_id: "room_alpha",
      agent_type: "codex",
      permission_level: "read_only"
    };
    const code = buildConnectionCode(payload);
    expect(code).toMatch(/^CACP-CONNECT:v1:[A-Za-z0-9_-]+$/);
    expect(parseConnectionCode(code)).toEqual(payload);
  });

  it("rejects malformed codes", () => {
    expect(() => parseConnectionCode("bad")).toThrow("invalid_connection_code");
    expect(() => parseConnectionCode("CACP-CONNECT:v2:e30")).toThrow("invalid_connection_code");
  });

  it("accepts invite approval and removal event types", () => {
    for (const type of [
      "join_request.created",
      "join_request.approved",
      "join_request.rejected",
      "join_request.expired",
      "participant.removed"
    ]) {
      expect(EventTypeSchema.parse(type)).toBe(type);
    }
  });
});
