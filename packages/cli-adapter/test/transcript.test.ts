import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { CacpEvent, Participant } from "@cacp/protocol";
import { ChatTranscriptWriter, formatChatMessage, transcriptPathForRoom } from "../src/transcript.js";

function baseEvent(type: CacpEvent["type"], payload: Record<string, unknown>, actorId = "user_1"): CacpEvent {
  return {
    protocol: "cacp",
    version: "0.2.0",
    event_id: `evt_${type}_${Math.random().toString(16).slice(2)}`,
    room_id: "room_1",
    type,
    actor_id: actorId,
    created_at: "2026-04-28T03:30:00.000Z",
    payload
  };
}

function participant(id: string, displayName: string): Participant {
  return { id, display_name: displayName, type: "human", role: "member" };
}

describe("chat transcript writer", () => {
  it("builds the per-room chat.md path under the connector directory", () => {
    expect(transcriptPathForRoom("D:\\Connector", "room_alpha")).toBe("D:\\Connector\\rooms\\room_alpha\\chat.md");
  });

  it("writes a Markdown header and appends named human and agent messages", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cacp-transcript-"));
    try {
      const writer = new ChatTranscriptWriter({
        roomId: "room_1",
        baseDir: tempDir,
        now: () => new Date("2026-04-28T03:29:00.000Z")
      });

      writer.handleEvent(baseEvent("participant.joined", { participant: participant("user_1", "Alice\nOwner") }));
      writer.handleEvent(baseEvent("participant.joined", { participant: { ...participant("agent_1", "Claude Code"), type: "agent", role: "agent" } }));
      writer.handleEvent(baseEvent("message.created", { message_id: "msg_1", text: "Hello team", kind: "human" }, "user_1"));
      writer.handleEvent(baseEvent("message.created", { message_id: "msg_2", text: "I am ready.", kind: "agent" }, "agent_1"));

      const text = readFileSync(join(tempDir, "rooms", "room_1", "chat.md"), "utf8");
      expect(text).toContain("# CACP Room Chat");
      expect(text).toContain("Room: room_1");
      expect(text).toContain("Started: 2026-04-28 03:29:00 UTC");
      expect(text).toContain("## 2026-04-28 03:30:00 UTC - Alice Owner");
      expect(text).toContain("Hello team");
      expect(text).toContain("## 2026-04-28 03:30:00 UTC - Claude Code");
      expect(text).toContain("I am ready.");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not append duplicate message ids", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cacp-transcript-"));
    try {
      const writer = new ChatTranscriptWriter({ roomId: "room_1", baseDir: tempDir });
      const event = baseEvent("message.created", { message_id: "msg_dup", text: "Only once", kind: "human" }, "user_1");

      writer.handleEvent(event);
      writer.handleEvent(event);

      const text = readFileSync(join(tempDir, "rooms", "room_1", "chat.md"), "utf8");
      expect(text.match(/Only once/g)).toHaveLength(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("falls back to event_id when message_id is absent", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cacp-transcript-"));
    try {
      const writer = new ChatTranscriptWriter({ roomId: "room_1", baseDir: tempDir });
      const event = baseEvent("message.created", { text: "Legacy message", kind: "human" }, "user_1");

      writer.handleEvent(event);
      writer.handleEvent(event);

      const text = readFileSync(join(tempDir, "rooms", "room_1", "chat.md"), "utf8");
      expect(text.match(/Legacy message/g)).toHaveLength(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps connector processing alive when the transcript path cannot be written", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cacp-transcript-blocked-"));
    const blockedBase = join(tempDir, "not-a-dir");
    const logger = { warn: vi.fn() };
    try {
      writeFileSync(blockedBase, "file blocks directory creation", "utf8");
      const writer = new ChatTranscriptWriter({ roomId: "room_1", baseDir: blockedBase, logger });

      expect(() => writer.handleEvent(baseEvent("message.created", { message_id: "msg_1", text: "Still connected" }))).not.toThrow();
      expect(writer.isAvailable()).toBe(false);
      expect(writer.lastErrorMessage()).toContain("Unable to write chat transcript");
      expect(logger.warn).toHaveBeenCalled();
      expect(existsSync(join(blockedBase, "rooms", "room_1", "chat.md"))).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not duplicate messages already present in an existing chat.md", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cacp-transcript-restart-"));
    try {
      const roomDir = join(tempDir, "rooms", "room_1");
      mkdirSync(roomDir, { recursive: true });
      writeFileSync(join(roomDir, "chat.md"), [
        "# CACP Room Chat",
        "",
        "Room: room_1",
        "Started: 2026-04-28 03:29:00 UTC",
        "",
        "---",
        "",
        "## 2026-04-28 03:30:00 UTC - Alice",
        "",
        "Hello team",
        "",
        "<!-- cacp-message-key: msg_restart -->",
        ""
      ].join("\n"), "utf8");

      const writer = new ChatTranscriptWriter({ roomId: "room_1", baseDir: tempDir });
      writer.handleEvent(baseEvent("message.created", { message_id: "msg_restart", text: "Hello team", kind: "human" }, "user_1"));

      const text = readFileSync(join(roomDir, "chat.md"), "utf8");
      expect(text.match(/Hello team/g)).toHaveLength(1);
      expect(text.match(/<!-- cacp-message-key: msg_restart -->/g)).toHaveLength(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("formatChatMessage", () => {
  it("uses the actor id when no display name is known", () => {
    expect(formatChatMessage({
      actorName: "user_99",
      createdAt: "2026-04-28T03:30:00.000Z",
      text: "Fallback name"
    })).toContain("## 2026-04-28 03:30:00 UTC - user_99");
  });
});
