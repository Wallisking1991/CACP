import { describe, expect, it } from "vitest";
import type { CacpEvent } from "@cacp/protocol";
import { pairingServerUrlFor, parseCacpEventMessage } from "../src/api.js";

const validEvent = {
  protocol: "cacp",
  version: "0.1.0",
  event_id: "evt_1",
  room_id: "room_1",
  type: "message.created",
  actor_id: "user_1",
  created_at: "2026-04-25T00:00:00.000Z",
  payload: { text: "hello" }
} satisfies CacpEvent;

describe("API event parsing", () => {
  it("returns a valid event from websocket message data", () => {
    expect(parseCacpEventMessage(JSON.stringify(validEvent))).toEqual(validEvent);
  });

  it("returns undefined for malformed JSON without throwing", () => {
    expect(() => parseCacpEventMessage("not json")).not.toThrow();
    expect(parseCacpEventMessage("not json")).toBeUndefined();
  });

  it("returns undefined for JSON that is not a CACP event", () => {
    expect(parseCacpEventMessage(JSON.stringify({ hello: "world" }))).toBeUndefined();
  });

  it("points generated local adapter commands at the API server when running through Vite dev server", () => {
    expect(pairingServerUrlFor("http://127.0.0.1:5173")).toBe("http://127.0.0.1:3737");
    expect(pairingServerUrlFor("http://localhost:5173")).toBe("http://localhost:3737");
    expect(pairingServerUrlFor("https://cacp.example.com")).toBe("https://cacp.example.com");
  });
});
