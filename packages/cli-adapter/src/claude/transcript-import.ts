import { randomUUID } from "node:crypto";
import type { ClaudeSessionImportSourceKindSchema } from "@cacp/protocol";
import type { z } from "zod";
import { loadClaudeSdk } from "./claude-sdk.js";
import type { ClaudeImportResult, ClaudeImportedMessage, ClaudeSdk, ClaudeSdkSessionMessage } from "./types.js";

type SourceKind = z.infer<typeof ClaudeSessionImportSourceKindSchema>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function toolSummary(item: Record<string, unknown>): string {
  const name = typeof item.name === "string" ? item.name : "tool";
  const input = record(item.input);
  const filePath = typeof input.file_path === "string" ? ` ${input.file_path}` : "";
  const command = typeof input.command === "string" ? ` ${input.command}` : "";
  return `Tool use: ${name}${filePath}${command}`;
}

function contentToVisibleParts(content: unknown): { text: string; sourceKind: SourceKind }[] {
  if (typeof content === "string") return [{ text: content, sourceKind: "assistant" }];
  if (!Array.isArray(content)) return [];
  const parts: { text: string; sourceKind: SourceKind }[] = [];
  for (const item of content) {
    const itemRecord = record(item);
    if (itemRecord.type === "text" && typeof itemRecord.text === "string") {
      parts.push({ text: itemRecord.text, sourceKind: "assistant" });
    }
    if (itemRecord.type === "tool_use") {
      parts.push({ text: toolSummary(itemRecord), sourceKind: "tool_use" });
    }
    if (itemRecord.type === "tool_result") {
      const text = typeof itemRecord.content === "string" ? itemRecord.content : "Tool result received";
      parts.push({ text, sourceKind: "tool_result" });
    }
  }
  return parts;
}

function authorRoleFor(message: ClaudeSdkSessionMessage, sourceKind: SourceKind): ClaudeImportedMessage["author_role"] {
  if (sourceKind === "tool_use" || sourceKind === "tool_result") return "tool";
  if (message.role === "user") return "user";
  if (message.role === "assistant") return "assistant";
  return "system";
}

export async function buildClaudeImportFromSessionMessages(input: {
  sdk?: Pick<ClaudeSdk, "getSessionMessages">;
  importId?: string;
  agentId: string;
  workingDir: string;
  sessionId: string;
  title: string;
}): Promise<ClaudeImportResult> {
  const sdk = input.sdk ?? await loadClaudeSdk();
  const importId = input.importId ?? `import_${randomUUID()}`;
  const messages = await sdk.getSessionMessages({ workingDir: input.workingDir, sessionId: input.sessionId });
  const imported: ClaudeImportedMessage[] = [];
  for (const message of messages) {
    const sourceMessageId = message.id;
    const originalCreatedAt = message.timestamp ?? message.created_at;
    const parts = message.role === "user"
      ? [{ text: typeof message.content === "string" ? message.content : JSON.stringify(message.content), sourceKind: "user" as const }]
      : contentToVisibleParts(message.content);
    for (const part of parts) {
      const text = part.text.trim();
      if (!text) continue;
      imported.push({
        import_id: importId,
        agent_id: input.agentId,
        session_id: input.sessionId,
        sequence: imported.length,
        ...(sourceMessageId ? { source_message_id: sourceMessageId } : {}),
        ...(originalCreatedAt ? { original_created_at: originalCreatedAt } : {}),
        author_role: authorRoleFor(message, part.sourceKind),
        source_kind: part.sourceKind,
        text: text.slice(0, 20000)
      });
    }
  }
  return { importId, sessionId: input.sessionId, title: input.title, messages: imported };
}

export function chunkClaudeImportMessages(messages: ClaudeImportedMessage[], size = 50): ClaudeImportedMessage[][] {
  const chunks: ClaudeImportedMessage[][] = [];
  for (let index = 0; index < messages.length; index += size) {
    chunks.push(messages.slice(index, index + size));
  }
  return chunks;
}
