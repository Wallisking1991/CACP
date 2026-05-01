import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MainThreadLedger } from "../src/connector/main-ledger.js";
import type { ConnectorLedgerEntry } from "@cacp/protocol";

describe("MainThreadLedger", () => {
  let tempDir: string;
  let ledger: MainThreadLedger;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cacp-ledger-test-"));
    ledger = new MainThreadLedger({
      roomId: "room_1",
      connectorId: "conn_1",
      agentId: "agent_1",
      ledgerDir: tempDir
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("appends entries with monotonic sequence numbers", () => {
    const entry1 = ledger.append({
      entry_type: "human_input",
      actor_id: "u1",
      actor_name: "Alice",
      actor_role: "owner",
      text: "Hello",
      source: "composer",
      created_at: "2026-05-01T00:00:00.000Z"
    });
    const entry2 = ledger.append({
      entry_type: "agent_final",
      actor_id: "agent_1",
      actor_name: "Claude",
      actor_role: "agent",
      text: "Hi there",
      source: "composer",
      created_at: "2026-05-01T00:00:01.000Z",
      turn_id: "turn_1"
    });

    expect(entry1.sequence).toBe(0);
    expect(entry2.sequence).toBe(1);
  });

  it("writes entries to main-thread.jsonl", () => {
    ledger.append({
      entry_type: "human_input",
      actor_id: "u1",
      actor_name: "Alice",
      actor_role: "owner",
      text: "Hello",
      source: "composer",
      created_at: "2026-05-01T00:00:00.000Z"
    });

    const ledgerPath = join(tempDir, "main-thread.jsonl");
    expect(existsSync(ledgerPath)).toBe(true);
    const content = readFileSync(ledgerPath, "utf8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.text).toBe("Hello");
    expect(parsed.ledger_version).toBe(1);
  });

  it("snapshotSince returns entries from the given sequence", () => {
    ledger.append({
      entry_type: "human_input",
      actor_id: "u1",
      actor_name: "Alice",
      actor_role: "owner",
      text: "First",
      source: "composer",
      created_at: "2026-05-01T00:00:00.000Z"
    });
    ledger.append({
      entry_type: "human_input",
      actor_id: "u2",
      actor_name: "Bob",
      actor_role: "member",
      text: "Second",
      source: "composer",
      created_at: "2026-05-01T00:00:01.000Z"
    });
    ledger.append({
      entry_type: "agent_final",
      actor_id: "agent_1",
      actor_name: "Claude",
      actor_role: "agent",
      text: "Third",
      source: "composer",
      created_at: "2026-05-01T00:00:02.000Z",
      turn_id: "turn_1"
    });

    const snapshot = ledger.snapshotSince(1);
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0].text).toBe("Second");
    expect(snapshot[1].text).toBe("Third");
  });

  it("snapshotSince returns all entries when since_sequence is 0", () => {
    ledger.append({
      entry_type: "human_input",
      actor_id: "u1",
      actor_name: "Alice",
      actor_role: "owner",
      text: "Only",
      source: "composer",
      created_at: "2026-05-01T00:00:00.000Z"
    });

    const snapshot = ledger.snapshotSince(0);
    expect(snapshot).toHaveLength(1);
  });

  it("snapshotSince returns empty array when sequence exceeds latest", () => {
    ledger.append({
      entry_type: "human_input",
      actor_id: "u1",
      actor_name: "Alice",
      actor_role: "owner",
      text: "Only",
      source: "composer",
      created_at: "2026-05-01T00:00:00.000Z"
    });

    const snapshot = ledger.snapshotSince(5);
    expect(snapshot).toHaveLength(0);
  });

  it("does not write token-like strings to the ledger file", () => {
    const tokenLike = "sk-abc123def456ghi789";
    ledger.append({
      entry_type: "human_input",
      actor_id: "u1",
      actor_name: "Alice",
      actor_role: "owner",
      text: `My key is ${tokenLike}`,
      source: "composer",
      created_at: "2026-05-01T00:00:00.000Z"
    });

    const ledgerPath = join(tempDir, "main-thread.jsonl");
    const content = readFileSync(ledgerPath, "utf8");
    expect(content).not.toContain(tokenLike);
    expect(content).toContain("[REDACTED_API_KEY]");
  });

  it("reloads existing ledger on construction", () => {
    ledger.append({
      entry_type: "human_input",
      actor_id: "u1",
      actor_name: "Alice",
      actor_role: "owner",
      text: "Existing",
      source: "composer",
      created_at: "2026-05-01T00:00:00.000Z"
    });

    const ledger2 = new MainThreadLedger({
      roomId: "room_1",
      connectorId: "conn_1",
      agentId: "agent_1",
      ledgerDir: tempDir
    });

    const snapshot = ledger2.snapshotSince(0);
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].text).toBe("Existing");
  });
});
