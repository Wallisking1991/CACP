import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("persists cloud records across file-backed reopen", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cacp-cloud-store-"));
    const dbPath = join(tempDir, "cloud.db");

    try {
      const firstStore = new EventStore(dbPath);
      firstStore.createRoom({ room_id: "room_file", name: "File Room", owner_participant_id: "user_owner", created_at: "2026-04-27T00:00:00.000Z", archived_at: null });
      firstStore.createInvite({ invite_id: "inv_file", room_id: "room_file", token_hash: "hash_file", role: "member", created_by: "user_owner", created_at: "2026-04-27T00:00:00.000Z", expires_at: "2026-04-28T00:00:00.000Z", max_uses: null });
      firstStore.createAgentPairing({ pairing_id: "pair_file", room_id: "room_file", token_hash: "pair_hash_file", created_by: "user_owner", agent_type: "echo", permission_level: "read_only", working_dir: ".", created_at: "2026-04-27T00:00:00.000Z", expires_at: "2026-04-27T00:15:00.000Z" });
      firstStore.close();

      const reopenedStore = new EventStore(dbPath);
      expect(reopenedStore.getRoom("room_file")?.name).toBe("File Room");
      expect(reopenedStore.getInviteByTokenHash("hash_file")?.invite_id).toBe("inv_file");
      expect(reopenedStore.getAgentPairingByTokenHash("pair_hash_file")?.pairing_id).toBe("pair_file");
      reopenedStore.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("preserves invite error semantics", () => {
    const store = new EventStore(":memory:");
    store.createInvite({ invite_id: "inv_revoked", room_id: "room_alpha", token_hash: "hash_revoked", role: "member", created_by: "user_owner", created_at: "2026-04-27T00:00:00.000Z", expires_at: "2026-04-28T00:00:00.000Z", max_uses: 2 });
    store.revokeInvite("inv_revoked", "2026-04-27T00:05:00.000Z");

    expect(() => store.consumeInvite("inv_missing")).toThrow("invite_not_found");
    expect(() => store.consumeInvite("inv_revoked")).toThrow("invite_revoked");
    store.close();
  });

  it("preserves pairing error semantics", () => {
    const store = new EventStore(":memory:");

    expect(() => store.claimAgentPairing("pair_missing", "2026-04-27T00:01:00.000Z")).toThrow("pairing_not_found");
    store.close();
  });

  it("uses conditional atomic updates for invite consumption and pairing claims", () => {
    const eventStoreSource = readFileSync(new URL("../src/event-store.ts", import.meta.url), "utf8").replace(/\s+/g, " ");

    expect(eventStoreSource).toContain("WHERE invite_id = ? AND revoked_at IS NULL AND (max_uses IS NULL OR used_count < max_uses)");
    expect(eventStoreSource).toContain("WHERE pairing_id = ? AND claimed_at IS NULL");
  });
});
