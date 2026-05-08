import { randomUUID } from "node:crypto";
import type { AgentSessionImportMessagePayload } from "@cacp/protocol";
import { loadKimiSdk } from "./kimi-sdk.js";
import type { KimiSdk, KimiSdkStreamEvent } from "./types.js";

const MaxImportTextLength = 20000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function extractText(input: string | unknown[]): string {
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return "";
  return input.map((item) => {
    const record = asRecord(item);
    if (record.type === "text" && typeof record.text === "string") return record.text;
    return "";
  }).join("");
}

function userTextFromTurnBegin(event: KimiSdkStreamEvent): string | undefined {
  if (event.type !== "TurnBegin") return undefined;
  const payload = asRecord(event.payload);
  const userInput = payload.user_input;
  const text = extractText(userInput as string | unknown[]);
  return text.trim() || undefined;
}

function textFromContentPart(event: KimiSdkStreamEvent): string | undefined {
  if (event.type !== "ContentPart") return undefined;
  const payload = asRecord(event.payload);
  if (payload.type === "text" && typeof payload.text === "string") return payload.text;
  if (payload.type === "think" && typeof payload.think === "string") return payload.think;
  return undefined;
}

function toolSummaryFromToolCall(event: KimiSdkStreamEvent): string | undefined {
  if (event.type !== "ToolCall") return undefined;
  const payload = asRecord(event.payload);
  const func = asRecord(payload.function);
  const name = typeof func.name === "string" ? func.name : "tool";
  const args = typeof func.arguments === "string" ? func.arguments : "";
  return `Tool use: ${name} ${args}`.trim();
}

function toolResultFromToolResult(event: KimiSdkStreamEvent): string | undefined {
  if (event.type !== "ToolResult") return undefined;
  const payload = asRecord(event.payload);
  const returnValue = asRecord(payload.return_value);
  const output = typeof returnValue.output === "string" ? returnValue.output : "";
  const message = typeof returnValue.message === "string" ? returnValue.message : "";
  return (output || message || "Tool result received").trim() || undefined;
}

export async function buildKimiImportFromSessionEvents(input: {
  sdk?: KimiSdk;
  importId?: string;
  agentId: string;
  workingDir: string;
  sessionId: string;
  title: string;
}): Promise<{ importId: string; sessionId: string; title: string; messages: AgentSessionImportMessagePayload[] }> {
  const sdk = input.sdk ?? await loadKimiSdk();
  const importId = input.importId ?? `import_${randomUUID()}`;
  const events = await sdk.parseSessionEvents(input.workingDir, input.sessionId);

  const messages: AgentSessionImportMessagePayload[] = [];

  for (const event of events) {
    const kimEvent = event as KimiSdkStreamEvent;
    let text: string | undefined;
    let authorRole: AgentSessionImportMessagePayload["author_role"] = "system";
    let sourceKind: AgentSessionImportMessagePayload["source_kind"] = "system";

    switch (kimEvent.type) {
      case "TurnBegin": {
        text = userTextFromTurnBegin(kimEvent);
        authorRole = "user";
        sourceKind = "user";
        break;
      }
      case "ContentPart": {
        text = textFromContentPart(kimEvent);
        authorRole = "assistant";
        sourceKind = "assistant";
        break;
      }
      case "ToolCall": {
        text = toolSummaryFromToolCall(kimEvent);
        authorRole = "tool";
        sourceKind = "tool_use";
        break;
      }
      case "ToolResult": {
        text = toolResultFromToolResult(kimEvent);
        authorRole = "tool";
        sourceKind = "tool_result";
        break;
      }
      default:
        continue;
    }

    if (!text || !text.trim()) continue;

    const chunks: string[] = [];
    for (let offset = 0; offset < text.length; offset += MaxImportTextLength) {
      chunks.push(text.slice(offset, offset + MaxImportTextLength));
    }

    chunks.forEach((chunk, index) => {
      messages.push({
        import_id: importId,
        agent_id: input.agentId,
        session_id: input.sessionId,
        sequence: messages.length,
        author_role: authorRole,
        source_kind: sourceKind,
        text: chunk,
        provider: "kimi-cli",
        ...(chunks.length > 1 ? { part_index: index, part_count: chunks.length, truncated: false } : {})
      });
    });
  }

  return { importId, sessionId: input.sessionId, title: input.title, messages };
}

export function chunkKimiImportMessages(messages: AgentSessionImportMessagePayload[], size = 50): AgentSessionImportMessagePayload[][] {
  const chunks: AgentSessionImportMessagePayload[][] = [];
  for (let index = 0; index < messages.length; index += size) {
    chunks.push(messages.slice(index, index + size));
  }
  return chunks;
}
