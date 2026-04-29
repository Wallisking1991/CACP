import { randomUUID } from "node:crypto";
import type { ClaudeSessionImportSourceKindSchema } from "@cacp/protocol";
import type { z } from "zod";
import { loadClaudeSdk } from "./claude-sdk.js";
import type { ClaudeImportResult, ClaudeImportedMessage, ClaudeSdk, ClaudeSdkSessionMessage } from "./types.js";

type SourceKind = z.infer<typeof ClaudeSessionImportSourceKindSchema>;
const MaxImportTextLength = 20000;
type VisiblePart = { text: string; sourceKind: SourceKind };

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

function commandSummary(item: Record<string, unknown>): string {
  const input = record(item.input);
  const command = typeof input.command === "string" ? input.command : "";
  return command ? `Command: ${command}` : "Command executed";
}

function visibleText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(visibleText).filter(Boolean).join("");
  const valueRecord = record(value);
  if (typeof valueRecord.text === "string") return valueRecord.text;
  if ("content" in valueRecord) return visibleText(valueRecord.content);
  return "";
}

function contentToVisibleParts(content: unknown, messageType: string | undefined): VisiblePart[] {
  const textSourceKind: SourceKind = messageType === "user" ? "user" : messageType === "assistant" ? "assistant" : "system";
  if (typeof content === "string") return [{ text: content, sourceKind: textSourceKind }];
  if (!Array.isArray(content)) return [];
  const parts: VisiblePart[] = [];
  for (const item of content) {
    const itemRecord = record(item);
    if (itemRecord.type === "text" && typeof itemRecord.text === "string") {
      parts.push({ text: itemRecord.text, sourceKind: textSourceKind });
    }
    if (itemRecord.type === "tool_use") {
      const name = typeof itemRecord.name === "string" ? itemRecord.name : "";
      parts.push(name === "Bash"
        ? { text: commandSummary(itemRecord), sourceKind: "command" }
        : { text: toolSummary(itemRecord), sourceKind: "tool_use" });
    }
    if (itemRecord.type === "tool_result") {
      const text = visibleText(itemRecord.content) || "Tool result received";
      parts.push({ text, sourceKind: "tool_result" });
    }
  }
  return parts;
}

function authorRoleFor(message: ClaudeSdkSessionMessage, sourceKind: SourceKind): ClaudeImportedMessage["author_role"] {
  if (sourceKind === "command") return "command";
  if (sourceKind === "tool_use" || sourceKind === "tool_result") return "tool";
  if (message.type === "user") return "user";
  if (message.type === "assistant") return "assistant";
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
  const messages = await sdk.getSessionMessages(input.sessionId, { dir: input.workingDir, includeSystemMessages: true });
  const imported: ClaudeImportedMessage[] = [];
  for (const message of messages) {
    const sourceMessageId = message.uuid;
    const msgRecord = record(message.message);
    const content = msgRecord.content ?? message.message;
    const parts = contentToVisibleParts(content, message.type);
    for (const part of parts) {
      const text = part.text.trim();
      if (!text) continue;
      const chunks: string[] = [];
      for (let offset = 0; offset < text.length; offset += MaxImportTextLength) {
        chunks.push(text.slice(offset, offset + MaxImportTextLength));
      }
      const partCount = chunks.length;
      chunks.forEach((chunk, index) => {
        imported.push({
          import_id: importId,
          agent_id: input.agentId,
          session_id: input.sessionId,
          sequence: imported.length,
          ...(sourceMessageId ? { source_message_id: sourceMessageId } : {}),
          author_role: authorRoleFor(message, part.sourceKind),
          source_kind: part.sourceKind,
          text: chunk,
          ...(partCount > 1 ? { part_index: index, part_count: partCount, truncated: false } : {})
        });
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
