import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ClaudeSessionImportAuthorRoleSchema, ClaudeSessionImportSourceKindSchema } from "@cacp/protocol";
import type { z } from "zod";
import type { ClaudeImportResult, ClaudeImportedMessage } from "../claude/types.js";

type AuthorRole = z.infer<typeof ClaudeSessionImportAuthorRoleSchema>;
type SourceKind = z.infer<typeof ClaudeSessionImportSourceKindSchema>;

interface CodexRecord {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

function parseRecords(filePath: string): CodexRecord[] {
  try {
    const content = readFileSync(filePath, "utf8");
    const records: CodexRecord[] = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line) as CodexRecord);
      } catch {
        // Skip malformed lines
      }
    }
    return records;
  } catch {
    return [];
  }
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(textFromContent).filter(Boolean).join("");
  }
  if (content && typeof content === "object") {
    const record = content as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.output === "string") return record.output;
  }
  return "";
}

function mapRecordToMessages(
  record: CodexRecord,
  importId: string,
  agentId: string,
  sessionId: string,
  sequenceStart: number
): ClaudeImportedMessage[] {
  if (record.type !== "response_item") return [];
  const payload = record.payload ?? {};
  const payloadType = typeof payload.type === "string" ? payload.type : "";

  if (payloadType === "message") {
    const role = typeof payload.role === "string" ? payload.role : "";
    const text = textFromContent(payload.content);
    if (!text.trim()) return [];

    const authorRole: AuthorRole = role === "user" ? "user" : role === "assistant" ? "assistant" : "system";
    const sourceKind: SourceKind = role === "user" ? "user" : role === "assistant" ? "assistant" : "system";

    return [{
      import_id: importId,
      agent_id: agentId,
      session_id: sessionId,
      sequence: sequenceStart,
      author_role: authorRole,
      source_kind: sourceKind,
      text: text.trim()
    }];
  }

  if (payloadType === "function_call") {
    const name = typeof payload.name === "string" ? payload.name : "";
    let args = "";
    try {
      if (typeof payload.arguments === "string") {
        const parsed = JSON.parse(payload.arguments) as Record<string, unknown>;
        args = typeof parsed.command === "string" ? parsed.command : "";
      }
    } catch {
      // Ignore parse errors
    }
    const text = name === "shell_command" && args ? `Command: ${args}` : `Tool: ${name}`;

    return [{
      import_id: importId,
      agent_id: agentId,
      session_id: sessionId,
      sequence: sequenceStart,
      author_role: "command",
      source_kind: "command",
      text
    }];
  }

  if (payloadType === "function_call_output") {
    const output = typeof payload.output === "string" ? payload.output : textFromContent(payload.output);
    if (!output.trim()) return [];

    return [{
      import_id: importId,
      agent_id: agentId,
      session_id: sessionId,
      sequence: sequenceStart,
      author_role: "tool",
      source_kind: "tool_result",
      text: output.trim()
    }];
  }

  return [];
}

export async function buildCodexImportFromSessionFile(input: {
  importId?: string;
  agentId: string;
  sessionId: string;
  title: string;
  filePath: string;
}): Promise<ClaudeImportResult> {
  const importId = input.importId ?? `import_${randomUUID()}`;
  const records = parseRecords(input.filePath);
  const messages: ClaudeImportedMessage[] = [];

  for (const record of records) {
    const mapped = mapRecordToMessages(record, importId, input.agentId, input.sessionId, messages.length);
    messages.push(...mapped);
  }

  return { importId, sessionId: input.sessionId, title: input.title, messages };
}

export async function findCodexSessionFile(input: {
  sessionId: string;
  codexHome?: string;
}): Promise<string | undefined> {
  const root = input.codexHome ?? join(homedir(), ".codex");
  const sessionsDir = join(root, "sessions");

  function scan(dir: string): string | undefined {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = scan(fullPath);
          if (found) return found;
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          const firstLine = readFileSync(fullPath, "utf8").split("\n")[0];
          if (!firstLine) continue;
          try {
            const record = JSON.parse(firstLine) as CodexRecord;
            if (record.type === "session_meta") {
              const payload = record.payload ?? {};
              if (typeof payload.id === "string" && payload.id === input.sessionId) {
                return fullPath;
              }
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch {
      // Directory may not exist
    }
    return undefined;
  }

  return scan(sessionsDir);
}

export function chunkCodexImportMessages(messages: ClaudeImportedMessage[], size = 50): ClaudeImportedMessage[][] {
  const chunks: ClaudeImportedMessage[][] = [];
  for (let index = 0; index < messages.length; index += size) {
    chunks.push(messages.slice(index, index + size));
  }
  return chunks;
}
