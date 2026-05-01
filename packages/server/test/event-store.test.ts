import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { CacpEvent } from "@cacp/protocol";
import { EventStore } from "../src/event-store.js";

function testEvent(eventId: string, type: CacpEvent["type"]): CacpEvent {
  return {
    protocol: "cacp",
    version: "0.1.0",
    event_id: eventId,
    room_id: "room_order",
    type,
    actor_id: "user_owner",
    created_at: "2026-04-25T10:00:00.000Z",
    payload: {}
  };
}

describe("EventStore", () => {
  it("preserves insertion order for events with identical created_at timestamps", () => {
    const store = new EventStore(":memory:");

    store.appendEvent(testEvent("evt_z", "message.created"));
    store.appendEvent(testEvent("evt_a", "ai.collection.started"));
    store.appendEvent(testEvent("evt_m", "proposal.created"));

    expect(store.listEvents("room_order").map((event) => event.event_id)).toEqual(["evt_z", "evt_a", "evt_m"]);

    store.close();
  });

  it("persists LLM API agent pairings", () => {
    const store = new EventStore(":memory:");
    try {
      const stored = store.createAgentPairing({
        pairing_id: "pair_llm",
        room_id: "room_llm",
        token_hash: "sha256:abc",
        created_by: "user_owner",
        agent_type: "llm-api",
        permission_level: "read_only",
        working_dir: ".",
        created_at: "2026-04-28T00:00:00.000Z",
        expires_at: "2026-04-28T00:15:00.000Z"
      });
      expect(stored.agent_type).toBe("llm-api");
    } finally {
      store.close();
    }
  });

  it("migrates old agent_pairings schema that lacks llm-api", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cacp-event-store-migrate-"));
    const dbPath = join(tempDir, "test.db");

    try {
      // Simulate a database that was previously migrated to include
      // llm-openai-compatible but not the newer llm-api type.
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE agent_pairings (
          pairing_id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          created_by TEXT NOT NULL,
          agent_type TEXT NOT NULL CHECK(agent_type IN ('claude-code', 'codex', 'opencode', 'echo', 'llm-openai-compatible', 'llm-anthropic-compatible')),
          permission_level TEXT NOT NULL CHECK(permission_level IN ('read_only', 'limited_write', 'full_access')),
          working_dir TEXT NOT NULL CHECK(length(working_dir) <= 500),
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          claimed_at TEXT
        );
        INSERT INTO agent_pairings (pairing_id, room_id, token_hash, created_by, agent_type, permission_level, working_dir, created_at, expires_at)
        VALUES ('pair_old', 'room_old', 'sha256:old', 'owner', 'llm-openai-compatible', 'read_only', '.', '2026-04-28T00:00:00.000Z', '2026-04-28T00:15:00.000Z');
      `);
      db.close();

      // Re-opening with EventStore should migrate the table
      const store = new EventStore(dbPath);
      try {
        const stored = store.createAgentPairing({
          pairing_id: "pair_new",
          room_id: "room_new",
          token_hash: "sha256:new",
          created_by: "user_owner",
          agent_type: "llm-api",
          permission_level: "read_only",
          working_dir: ".",
          created_at: "2026-04-28T00:00:00.000Z",
          expires_at: "2026-04-28T00:15:00.000Z"
        });
        expect(stored.agent_type).toBe("llm-api");
      } finally {
        store.close();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("persists Codex CLI agent pairings", () => {
    const store = new EventStore(":memory:");
    try {
      const stored = store.createAgentPairing({
        pairing_id: "pair_codex_cli",
        room_id: "room_codex",
        token_hash: "sha256:codex",
        created_by: "user_owner",
        agent_type: "codex-cli",
        permission_level: "limited_write",
        working_dir: "D:\\Development\\2",
        created_at: "2026-05-01T00:00:00.000Z",
        expires_at: "2026-05-01T00:15:00.000Z"
      });
      expect(stored.agent_type).toBe("codex-cli");
    } finally {
      store.close();
    }
  });

  it("migrates away legacy generic command pairings", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cacp-event-store-legacy-"));
    const dbPath = join(tempDir, "legacy.db");

    try {
      const legacy = new Database(dbPath);
      legacy.exec(`
        CREATE TABLE agent_pairings (
          pairing_id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          created_by TEXT NOT NULL,
          agent_type TEXT NOT NULL CHECK(agent_type IN ('claude-code', 'codex', 'opencode', 'echo')),
          permission_level TEXT NOT NULL CHECK(permission_level IN ('read_only', 'limited_write', 'full_access')),
          working_dir TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          claimed_at TEXT
        );
        INSERT INTO agent_pairings VALUES ('pair_claude', 'room_1', 'hash_1', 'owner', 'claude-code', 'read_only', '.', '2026-04-29T00:00:00.000Z', '2026-04-30T00:00:00.000Z', NULL);
        INSERT INTO agent_pairings VALUES ('pair_codex', 'room_1', 'hash_2', 'owner', 'codex', 'read_only', '.', '2026-04-29T00:00:00.000Z', '2026-04-30T00:00:00.000Z', NULL);
      `);
      legacy.close();

      const store = new EventStore(dbPath);
      const claudePairing = store.getAgentPairingById("pair_claude");
      const codexPairing = store.getAgentPairingById("pair_codex");
      expect(claudePairing?.agent_type).toBe("claude-code");
      expect(codexPairing).toBeUndefined();
      store.close();
    } finally {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors on Windows due to file handle timing
      }
    }
  });
});
