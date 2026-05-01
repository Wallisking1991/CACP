import { describe, expect, it } from "vitest";
import { roomDelivery, targetedDelivery, canDeliverEnvelope, type RelayEnvelope } from "../src/relay.js";

describe("relay delivery", () => {
  it("roomDelivery returns kind room", () => {
    const d = roomDelivery();
    expect(d.kind).toBe("room");
  });

  it("targetedDelivery returns kind targeted with deduped ids", () => {
    const d = targetedDelivery(["user_1", "agent_1", "user_1"]);
    expect(d.kind).toBe("targeted");
    if (d.kind === "targeted") {
      expect(d.participant_ids).toEqual(["user_1", "agent_1"]);
    }
  });

  it("canDeliverEnvelope allows room delivery for any participant", () => {
    const envelope: RelayEnvelope = {
      event: {
        protocol: "cacp",
        version: "0.2.0",
        event_id: "evt_1",
        room_id: "room_1",
        type: "message.created",
        actor_id: "user_1",
        created_at: "2026-05-01T00:00:00.000Z",
        payload: {}
      },
      delivery: roomDelivery()
    };
    expect(canDeliverEnvelope(envelope, { id: "user_2", room_id: "room_1", type: "human", display_name: "Bob", role: "member", main_thread_history_access: "allowed" })).toBe(true);
    expect(canDeliverEnvelope(envelope, { id: "agent_1", room_id: "room_1", type: "agent", display_name: "Agent", role: "agent", main_thread_history_access: "allowed" })).toBe(true);
  });

  it("canDeliverEnvelope allows targeted delivery only for listed participants", () => {
    const envelope: RelayEnvelope = {
      event: {
        protocol: "cacp",
        version: "0.2.0",
        event_id: "evt_1",
        room_id: "room_1",
        type: "connector.snapshot.entry",
        actor_id: "user_1",
        created_at: "2026-05-01T00:00:00.000Z",
        payload: {}
      },
      delivery: targetedDelivery(["user_1", "agent_1"])
    };
    expect(canDeliverEnvelope(envelope, { id: "user_1", room_id: "room_1", type: "human", display_name: "Alice", role: "owner", main_thread_history_access: "allowed" })).toBe(true);
    expect(canDeliverEnvelope(envelope, { id: "agent_1", room_id: "room_1", type: "agent", display_name: "Agent", role: "agent", main_thread_history_access: "allowed" })).toBe(true);
    expect(canDeliverEnvelope(envelope, { id: "user_2", room_id: "room_1", type: "human", display_name: "Bob", role: "member", main_thread_history_access: "allowed" })).toBe(false);
  });
});
