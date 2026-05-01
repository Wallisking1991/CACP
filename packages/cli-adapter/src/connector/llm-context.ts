import type { ConnectorLedgerEntry } from "@cacp/protocol";

export function buildLlmPromptFromLedger(input: {
  entries: ConnectorLedgerEntry[];
  currentInput: string;
  maxEntries?: number;
}): string {
  const maxEntries = input.maxEntries === undefined ? 20 : input.maxEntries;
  const history = input.entries.slice(-maxEntries).map((entry) => `${entry.actor_name}: ${entry.text}`).join("\n");
  return [
    "CACP room conversation context from the local Connector ledger.",
    "Recent ledger entries:",
    history || "No previous ledger entries.",
    "Current input:",
    input.currentInput
  ].join("\n");
}
