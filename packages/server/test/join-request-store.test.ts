import { describe, expect, it } from "vitest";
import { EventStore } from "../src/event-store.js";

describe("join requests and participant revocations", () => {
  it("stores multiple pending requests for the same invite", () => {
    const store = new EventStore(":memory:");
    store.createJoinRequest({
      request_id: "join_alpha",
      room_id: "room_alpha",
      invite_id: "inv_alpha",
      request_token_hash: "hash_join_alpha",
      display_name: "Alice",
      role: "member",
      status: "pending",
      requested_at: "2026-04-27T08:00:00.000Z",
      expires_at: "2026-04-27T08:10:00.000Z",
      requester_ip: "127.0.0.1",
      requester_user_agent: "vitest"
    });
    store.createJoinRequest({
      request_id: "join_beta",
      room_id: "room_alpha",
      invite_id: "inv_alpha",
      request_token_hash: "hash_join_beta",
      display_name: "Bob",
      role: "member",
      status: "pending",
      requested_at: "2026-04-27T08:01:00.000Z",
      expires_at: "2026-04-27T08:11:00.000Z"
    });
    expect(store.getJoinRequest("join_alpha")?.display_name).toBe("Alice");
    expect(store.getJoinRequest("join_beta")?.display_name).toBe("Bob");
    expect(store.countPendingJoinRequestsByInvite("inv_alpha")).toBe(2);
    store.close();
  });

  it("transitions a pending request once", () => {
    const store = new EventStore(":memory:");
    store.createJoinRequest({
      request_id: "join_alpha",
      room_id: "room_alpha",
      invite_id: "inv_alpha",
      request_token_hash: "hash_join_alpha",
      display_name: "Alice",
      role: "member",
      status: "pending",
      requested_at: "2026-04-27T08:00:00.000Z",
      expires_at: "2026-04-27T08:10:00.000Z"
    });
    const approved = store.approveJoinRequest("join_alpha", {
      decided_at: "2026-04-27T08:02:00.000Z",
      decided_by: "user_owner",
      participant_id: "user_alice",
      participant_token_sealed: "sealed_token"
    });
    expect(approved.status).toBe("approved");
    expect(() => store.rejectJoinRequest("join_alpha", "2026-04-27T08:03:00.000Z", "user_owner")).toThrow("join_request_not_pending");
    store.close();
  });

  it("marks participant tokens revoked", () => {
    const store = new EventStore(":memory:");
    store.addParticipant({ room_id: "room_alpha", id: "user_alice", token: "cacp_token", display_name: "Alice", type: "human", role: "member" });
    expect(store.getParticipantByToken("room_alpha", "cacp_token")?.id).toBe("user_alice");
    store.revokeParticipant("room_alpha", "user_alice", "user_owner", "2026-04-27T08:04:00.000Z", "removed_by_owner");
    expect(store.getParticipantByToken("room_alpha", "cacp_token")).toBeUndefined();
    expect(store.isParticipantRevoked("room_alpha", "user_alice")).toBe(true);
    store.close();
  });
});
