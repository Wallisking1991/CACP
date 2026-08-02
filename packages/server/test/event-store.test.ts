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
    version: "0.3.0",
    event_id: eventId,
    room_id: "room_order",
    type,
    actor_id: "user_owner",
    created_at: "2026-04-25T10:00:00.000Z",
    payload: {},
  };
}

describe("EventStore", () => {
  it("preserves insertion order for events with identical created_at timestamps", () => {
    const store = new EventStore(":memory:");

    store.appendEvent(testEvent("evt_z", "message.created"));
    store.appendEvent(testEvent("evt_a", "agent.turn.requested"));
    store.appendEvent(testEvent("evt_m", "proposal.created"));

    expect(
      store.listEvents("room_order").map((event) => event.event_id)
    ).toEqual(["evt_z", "evt_a", "evt_m"]);

    store.close();
  });

  it("preserves claimed pairing participant_id while migrating old agent type constraints", () => {
    const tempDir = mkdtempSync(
      join(tmpdir(), "cacp-event-store-participant-migrate-")
    );
    const dbPath = join(tempDir, "participant.db");

    try {
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE agent_pairings (
          pairing_id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          created_by TEXT NOT NULL,
          agent_type TEXT NOT NULL CHECK(agent_type IN ('claude-code', 'codex', 'opencode', 'echo')),
          permission_level TEXT NOT NULL CHECK(permission_level IN ('read_only', 'limited_write', 'full_access')),
          working_dir TEXT NOT NULL CHECK(length(working_dir) <= 500),
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          claimed_at TEXT,
          participant_id TEXT
        );
        INSERT INTO agent_pairings (
          pairing_id, room_id, token_hash, created_by, agent_type, permission_level, working_dir, created_at, expires_at, claimed_at, participant_id
        )
        VALUES (
          'pair_claimed', 'room_claimed', 'sha256:claimed', 'owner', 'claude-code', 'read_only', '.', '2026-04-28T00:00:00.000Z', '2026-04-28T00:15:00.000Z', '2026-04-28T00:01:00.000Z', 'agent_123'
        );
      `);
      db.close();

      const store = new EventStore(dbPath);
      try {
        expect(store.getAgentPairingById("pair_claimed")?.participant_id).toBe(
          "agent_123"
        );
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
        expires_at: "2026-05-01T00:15:00.000Z",
      });
      expect(stored.agent_type).toBe("codex-cli");
    } finally {
      store.close();
    }
  });

  it("claims only still-unbound attachments for abandoned cleanup", () => {
    const store = new EventStore(":memory:");
    const base = {
      room_id: "room_cleanup",
      created_by: "user_owner",
      name: "notes.txt",
      media_type: "text/plain",
      size_bytes: 5,
      sha256: "a".repeat(64),
      kind: "text" as const,
      disposition: "inline" as const,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    try {
      store.createAttachment({
        ...base,
        attachment_id: "att_abandoned",
      });
      store.createAttachment({
        ...base,
        attachment_id: "att_bound",
      });
      store.attachAttachments(
        "room_cleanup",
        ["att_bound"],
        "input_already_bound"
      );

      expect(
        store.deleteAbandonedAttachment(
          "room_cleanup",
          "att_abandoned",
          "2026-01-02T00:00:00.000Z"
        )
      ).toBe(true);
      expect(
        store.deleteAbandonedAttachment(
          "room_cleanup",
          "att_bound",
          "2026-01-02T00:00:00.000Z"
        )
      ).toBe(false);
      expect(
        store.getAttachment("room_cleanup", "att_abandoned")
      ).toBeUndefined();
      expect(store.getAttachment("room_cleanup", "att_bound")).toMatchObject({
        message_id: "input_already_bound",
      });
      expect(store.deleteUnboundAttachment("room_cleanup", "att_bound")).toBe(
        false
      );
    } finally {
      store.close();
    }
  });

  it("replaces whiteboard image references without disturbing other content", () => {
    const store = new EventStore(":memory:");
    const base = {
      room_id: "room_whiteboard",
      created_by: "user_owner",
      name: "diagram.png",
      media_type: "image/png",
      size_bytes: 16,
      sha256: "b".repeat(64),
      kind: "image" as const,
      disposition: "inline" as const,
      created_at: "2026-01-01T00:00:00.000Z",
    };
    try {
      store.createAttachment({ ...base, attachment_id: "att_board_only" });
      store.createAttachment({ ...base, attachment_id: "att_shared" });
      store.attachAttachments("room_whiteboard", ["att_shared"], "input_1");

      expect(
        store.replaceWhiteboardAttachmentReferences(
          "room_whiteboard",
          ["att_board_only", "att_shared"],
          { participantId: "user_owner", isOwner: true }
        )
      ).toEqual({ orphaned: [] });
      expect(
        store
          .getAttachmentsForReferences("room_whiteboard", "whiteboard", [
            "scene",
          ])
          .map((attachment) => attachment.attachment_id)
          .sort()
      ).toEqual(["att_board_only", "att_shared"]);
      expect(
        store.getAttachment("room_whiteboard", "att_board_only")
      ).toMatchObject({ message_id: "scene" });

      const removed = store.replaceWhiteboardAttachmentReferences(
        "room_whiteboard",
        [],
        { participantId: "user_owner", isOwner: true }
      );
      expect(removed.orphaned).toEqual([
        expect.objectContaining({ attachment_id: "att_board_only" }),
      ]);
      expect(
        store.getAttachment("room_whiteboard", "att_board_only")
      ).toBeUndefined();
      expect(
        store.getAttachment("room_whiteboard", "att_shared")
      ).toMatchObject({ message_id: "input_1" });
      expect(
        store.getAttachmentsForReferences("room_whiteboard", "main_input", [
          "input_1",
        ])
      ).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it("rejects unreadable, cross-room, and non-image whiteboard references", () => {
    const store = new EventStore(":memory:");
    const create = (
      attachmentId: string,
      roomId: string,
      createdBy: string,
      kind: "image" | "text"
    ) =>
      store.createAttachment({
        attachment_id: attachmentId,
        room_id: roomId,
        created_by: createdBy,
        name: kind === "image" ? "diagram.png" : "notes.txt",
        media_type: kind === "image" ? "image/png" : "text/plain",
        size_bytes: 16,
        sha256: attachmentId.padEnd(64, "c").slice(0, 64),
        kind,
        disposition: "inline",
        created_at: "2026-01-01T00:00:00.000Z",
      });
    try {
      create("att_other_member", "room_whiteboard", "user_other", "image");
      create("att_cross_room", "room_other", "user_member", "image");
      create("att_document", "room_whiteboard", "user_member", "text");

      expect(() =>
        store.replaceWhiteboardAttachmentReferences(
          "room_whiteboard",
          ["att_other_member"],
          { participantId: "user_member", isOwner: false }
        )
      ).toThrow("whiteboard_attachment_forbidden");
      expect(() =>
        store.replaceWhiteboardAttachmentReferences(
          "room_whiteboard",
          ["att_cross_room"],
          { participantId: "user_member", isOwner: false }
        )
      ).toThrow("whiteboard_attachment_not_found");
      expect(() =>
        store.replaceWhiteboardAttachmentReferences(
          "room_whiteboard",
          ["att_document"],
          { participantId: "user_member", isOwner: false }
        )
      ).toThrow("whiteboard_attachment_not_image");
    } finally {
      store.close();
    }
  });

  it("migrates legacy attachment reference constraints for whiteboards", () => {
    const tempDir = mkdtempSync(
      join(tmpdir(), "cacp-event-store-whiteboard-migrate-")
    );
    const dbPath = join(tempDir, "attachments.db");

    try {
      const legacy = new Database(dbPath);
      legacy.exec(`
        CREATE TABLE attachment_references (
          room_id TEXT NOT NULL,
          attachment_id TEXT NOT NULL,
          reference_type TEXT NOT NULL CHECK(reference_type IN ('main_input', 'orbit_note')),
          reference_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (room_id, attachment_id, reference_type, reference_id)
        );
        INSERT INTO attachment_references VALUES (
          'room_legacy', 'att_existing', 'main_input', 'input_1',
          '2026-01-01T00:00:00.000Z'
        );
      `);
      legacy.close();

      const store = new EventStore(dbPath);
      try {
        store.createAttachment({
          attachment_id: "att_board",
          room_id: "room_legacy",
          created_by: "user_owner",
          name: "board.png",
          media_type: "image/png",
          size_bytes: 16,
          sha256: "d".repeat(64),
          kind: "image",
          disposition: "inline",
          created_at: "2026-01-01T00:00:00.000Z",
        });
        store.replaceWhiteboardAttachmentReferences(
          "room_legacy",
          ["att_board"],
          { participantId: "user_owner", isOwner: true }
        );
        expect(
          store.getAttachmentsForReferences("room_legacy", "whiteboard", [
            "scene",
          ])
        ).toHaveLength(1);
      } finally {
        store.close();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
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
