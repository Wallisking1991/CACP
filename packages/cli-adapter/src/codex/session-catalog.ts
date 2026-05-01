import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentSessionSummary } from "@cacp/protocol";

interface CodexSessionMeta {
  id: string;
  timestamp?: string;
  cwd?: string;
  originator?: string;
  cli_version?: string;
  source?: string;
}

interface CodexRecord {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

function scanJsonlFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...scanJsonlFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory may not exist
  }
  return results;
}

function readFirstLine(filePath: string): string | undefined {
  try {
    const content = readFileSync(filePath, "utf8");
    const firstNewline = content.indexOf("\n");
    return firstNewline >= 0 ? content.slice(0, firstNewline) : content;
  } catch {
    return undefined;
  }
}

function parseMeta(line: string): CodexSessionMeta | undefined {
  try {
    const record = JSON.parse(line) as CodexRecord;
    if (record.type !== "session_meta") return undefined;
    const payload = record.payload ?? {};
    const id = typeof payload.id === "string" ? payload.id : undefined;
    if (!id) return undefined;
    return {
      id,
      timestamp: typeof payload.timestamp === "string" ? payload.timestamp : undefined,
      cwd: typeof payload.cwd === "string" ? payload.cwd : undefined,
      originator: typeof payload.originator === "string" ? payload.originator : undefined,
      cli_version: typeof payload.cli_version === "string" ? payload.cli_version : undefined,
      source: typeof payload.source === "string" ? payload.source : undefined
    };
  } catch {
    return undefined;
  }
}

function countVisibleMessages(filePath: string): number {
  try {
    const content = readFileSync(filePath, "utf8");
    let count = 0;
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as CodexRecord;
        if (record.type === "response_item") {
          const payload = record.payload ?? {};
          const payloadType = typeof payload.type === "string" ? payload.type : "";
          if (payloadType === "message" || payloadType === "function_call") {
            count++;
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
    return count;
  } catch {
    return 0;
  }
}

function fileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

export async function listCodexSessions(input: {
  workingDir: string;
  codexHome?: string;
  limit?: number;
}): Promise<{ workingDir: string; sessions: Array<AgentSessionSummary & { provider: "codex-cli" }> }> {
  const root = input.codexHome ?? join(homedir(), ".codex");
  const sessionsDir = join(root, "sessions");
  const files = scanJsonlFiles(sessionsDir);

  const sessions: Array<AgentSessionSummary & { provider: "codex-cli" }> = [];

  for (const filePath of files) {
    const firstLine = readFirstLine(filePath);
    if (!firstLine) continue;
    const meta = parseMeta(firstLine);
    if (!meta || meta.cwd !== input.workingDir) continue;

    const messageCount = countVisibleMessages(filePath);
    const updatedAt = meta.timestamp ?? new Date(0).toISOString();

    sessions.push({
      session_id: meta.id,
      title: `Codex session ${meta.id.slice(0, 8)}`,
      project_dir: meta.cwd ?? input.workingDir,
      updated_at: updatedAt,
      message_count: messageCount,
      byte_size: fileSize(filePath),
      importable: messageCount > 0,
      provider: "codex-cli"
    });
  }

  sessions.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  const limit = input.limit ?? 100;
  return { workingDir: input.workingDir, sessions: sessions.slice(0, limit) };
}
