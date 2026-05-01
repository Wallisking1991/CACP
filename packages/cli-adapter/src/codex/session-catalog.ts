import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize } from "node:path";
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
  let fd: number | undefined;
  try {
    fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    let line = "";
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead <= 0) break;
      const newline = buffer.subarray(0, bytesRead).indexOf(10);
      if (newline >= 0) {
        line += buffer.toString("utf8", 0, newline);
        break;
      }
      line += buffer.toString("utf8", 0, bytesRead);
      position += bytesRead;
    }
    return line.endsWith("\r") ? line.slice(0, -1) : line;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Ignore close errors while listing local session metadata.
      }
    }
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function extractContentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(extractContentText).filter(Boolean).join("");
  }
  const record = asRecord(value);
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  if (record.content !== undefined) return extractContentText(record.content);
  return "";
}

function titleFromUserMessage(payload: Record<string, unknown>): string | undefined {
  if (payload.role !== "user") return undefined;
  const text = extractContentText(payload.content).replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function newestTimestamp(current: string | undefined, candidate: unknown): string | undefined {
  if (typeof candidate !== "string") return current;
  const candidateMs = Date.parse(candidate);
  if (Number.isNaN(candidateMs)) return current;
  if (!current) return candidate;
  const currentMs = Date.parse(current);
  if (Number.isNaN(currentMs) || candidateMs > currentMs) return candidate;
  return current;
}

function readVisibleSessionStats(filePath: string): { messageCount: number; title?: string; lastVisibleAt?: string } {
  try {
    const content = readFileSync(filePath, "utf8");
    let messageCount = 0;
    let title: string | undefined;
    let lastVisibleAt: string | undefined;
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as CodexRecord;
        if (record.type === "response_item") {
          const payload = record.payload ?? {};
          const payloadType = typeof payload.type === "string" ? payload.type : "";
          if (payloadType === "message" || payloadType === "function_call" || payloadType === "function_call_output") {
            messageCount++;
            lastVisibleAt = newestTimestamp(lastVisibleAt, record.timestamp);
          }
          if (!title && payloadType === "message") {
            title = titleFromUserMessage(payload);
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
    return { messageCount, title, lastVisibleAt };
  } catch {
    return { messageCount: 0 };
  }
}

function normalizeWorkingDir(value: string): string {
  return normalize(value).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function fileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

function fileModifiedAt(filePath: string): string {
  try {
    return statSync(filePath).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

export async function listCodexSessions(input: {
  workingDir: string;
  codexHome?: string;
  limit?: number;
}): Promise<{ workingDir: string; sessions: Array<AgentSessionSummary & { provider: "codex-cli" }> }> {
  const root = input.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const sessionsDir = join(root, "sessions");
  const files = scanJsonlFiles(sessionsDir);
  const requestedWorkingDir = normalizeWorkingDir(input.workingDir);

  const sessions: Array<AgentSessionSummary & { provider: "codex-cli" }> = [];

  for (const filePath of files) {
    const firstLine = readFirstLine(filePath);
    if (!firstLine) continue;
    const meta = parseMeta(firstLine);
    if (!meta || !meta.cwd || normalizeWorkingDir(meta.cwd) !== requestedWorkingDir) continue;

    const { messageCount, title, lastVisibleAt } = readVisibleSessionStats(filePath);
    const updatedAt = lastVisibleAt ?? meta.timestamp ?? fileModifiedAt(filePath);

    sessions.push({
      session_id: meta.id,
      title: title ?? `Codex thread ${meta.id.slice(0, 8)}`,
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
