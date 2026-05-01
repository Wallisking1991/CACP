import { describe, expect, it } from "vitest";
import { buildLlmPromptFromLedger } from "../src/connector/llm-context.js";
import type { ConnectorLedgerEntry } from "@cacp/protocol";

function makeEntry(overrides: Partial<ConnectorLedgerEntry> = {}): ConnectorLedgerEntry {
  return {
    ledger_version: 1,
    room_id: "room_1",
    connector_id: "conn_1",
    agent_id: "agent_1",
    sequence: 0,
    entry_id: "entry_1",
    entry_type: "human_input",
    actor_id: "u1",
    actor_name: "Alice",
    actor_role: "owner",
    text: "Hello",
    source: "composer",
    created_at: "2026-05-01T00:00:00.000Z",
    ...overrides
  };
}

describe("buildLlmPromptFromLedger", () => {
  it("includes current input and recent ledger entries", () => {
    const entries = [
      makeEntry({ sequence: 0, actor_name: "Alice", text: "First message" }),
      makeEntry({ sequence: 1, actor_name: "Bob", text: "Second message" })
    ];
    const prompt = buildLlmPromptFromLedger({ entries, currentInput: "Current question" });
    expect(prompt).toContain("Current input:");
    expect(prompt).toContain("Current question");
    expect(prompt).toContain("Alice: First message");
    expect(prompt).toContain("Bob: Second message");
  });

  it("uses bounded recent entries with default max of 20", () => {
    const entries = Array.from({ length: 25 }, (_, i) =>
      makeEntry({ sequence: i, actor_name: `User${i}`, text: `Message ${i}` })
    );
    const prompt = buildLlmPromptFromLedger({ entries, currentInput: "Test" });
    expect(prompt).not.toContain("User0: Message 0");
    expect(prompt).not.toContain("User1: Message 1");
    expect(prompt).not.toContain("User2: Message 2");
    expect(prompt).not.toContain("User3: Message 3");
    expect(prompt).not.toContain("User4: Message 4");
    expect(prompt).toContain("User5: Message 5");
    expect(prompt).toContain("User24: Message 24");
  });

  it("respects custom maxEntries", () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry({ sequence: i, actor_name: `User${i}`, text: `Message ${i}` })
    );
    const prompt = buildLlmPromptFromLedger({ entries, currentInput: "Test", maxEntries: 3 });
    expect(prompt).not.toContain("User0: Message 0");
    expect(prompt).not.toContain("User6: Message 6");
    expect(prompt).toContain("User7: Message 7");
    expect(prompt).toContain("User9: Message 9");
  });

  it("shows fallback when no ledger entries", () => {
    const prompt = buildLlmPromptFromLedger({ entries: [], currentInput: "Test" });
    expect(prompt).toContain("No previous ledger entries");
  });

  it("labels context as from local Connector ledger", () => {
    const prompt = buildLlmPromptFromLedger({ entries: [], currentInput: "Test" });
    expect(prompt).toContain("CACP room conversation context from the local Connector ledger");
  });
});
