import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConnectorLedgerEntry } from "@cacp/protocol";

export interface MainThreadLedgerInput {
  roomId: string;
  connectorId: string;
  agentId: string;
  ledgerDir: string;
}

function sanitizeTokenLikeStrings(text: string): string {
  return text.replace(/\b(sk-[a-zA-Z0-9]{12,})\b/g, "[REDACTED_API_KEY]");
}

export class MainThreadLedger {
  private roomId: string;
  private connectorId: string;
  private agentId: string;
  private ledgerPath: string;
  private entries: ConnectorLedgerEntry[] = [];
  private nextSequence = 0;

  constructor(input: MainThreadLedgerInput) {
    this.roomId = input.roomId;
    this.connectorId = input.connectorId;
    this.agentId = input.agentId;
    this.ledgerPath = join(input.ledgerDir, "main-thread.jsonl");

    if (!existsSync(input.ledgerDir)) {
      mkdirSync(input.ledgerDir, { recursive: true });
    }

    this.reload();
  }

  private reload(): void {
    if (!existsSync(this.ledgerPath)) return;
    const content = readFileSync(this.ledgerPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as ConnectorLedgerEntry;
        this.entries.push(parsed);
        if (Number.isInteger(parsed.sequence) && parsed.sequence >= this.nextSequence) {
          this.nextSequence = parsed.sequence + 1;
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  append(input: Omit<ConnectorLedgerEntry, "ledger_version" | "room_id" | "connector_id" | "agent_id" | "sequence" | "entry_id">): ConnectorLedgerEntry {
    const sequence = this.nextSequence;
    const entry: ConnectorLedgerEntry = {
      ledger_version: 1,
      room_id: this.roomId,
      connector_id: this.connectorId,
      agent_id: this.agentId,
      sequence,
      entry_id: `entry_${randomUUID()}`,
      ...input,
      text: sanitizeTokenLikeStrings(input.text)
    };
    this.entries.push(entry);
    appendFileSync(this.ledgerPath, JSON.stringify(entry) + "\n");
    this.nextSequence += 1;
    return entry;
  }

  snapshotSince(sinceSequence: number): ConnectorLedgerEntry[] {
    return this.entries.filter((entry) => entry.sequence >= sinceSequence);
  }

  getLatestSequence(): number {
    return this.entries.length > 0 ? this.entries[this.entries.length - 1].sequence : -1;
  }
}
