import { describe, expect, it } from "vitest";
import { EventStore } from "../src/event-store.js";

describe("cloud persistence records", () => {
  it("persists rooms", () => {
    const store = new EventStore(":memory:");
    store.createRoom({ room_id: "room_alpha", name: "Alpha", owner_participant_id: "user_owner", created_at: "2026-04-27T00:00:00.000Z", archived_at: null });
    expect(store.getRoom("room_alpha")?.name).toBe("Alpha");
    store.close();
  });

  it("persists invite usage and prevents over-use", () => {
    const store = new EventStore(":memory:");
    store.createInvite({ invite_id: "inv_alpha", room_id: "room_alpha", token_hash: "hash_alpha", role: "member", created_by: "user_owner", created_at: "2026-04-27T00:00:00.000Z", expires_at: "2026-04-28T00:00:00.000Z", max_uses: 1 });
    expect(store.getInviteByTokenHash("hash_alpha")?.used_count).toBe(0);
    expect(store.consumeInvite("inv_alpha").used_count).toBe(1);
    expect(() => store.consumeInvite("inv_alpha")).toThrow("invite_use_limit_reached");
    store.close();
  });

  it("claims pairings once", () => {
    const store = new EventStore(":memory:");
    store.createAgentPairing({ pairing_id: "pair_alpha", room_id: "room_alpha", token_hash: "pair_hash_alpha", created_by: "user_owner", agent_type: "echo", permission_level: "read_only", working_dir: ".", created_at: "2026-04-27T00:00:00.000Z", expires_at: "2026-04-27T00:15:00.000Z" });
    expect(store.claimAgentPairing("pair_alpha", "2026-04-27T00:01:00.000Z").claimed_at).toBe("2026-04-27T00:01:00.000Z");
    expect(() => store.claimAgentPairing("pair_alpha", "2026-04-27T00:02:00.000Z")).toThrow("pairing_claimed");
    store.close();
  });
});
