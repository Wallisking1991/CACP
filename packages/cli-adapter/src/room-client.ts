import type {
  AgentRuntimeStatusChangedPayload,
  AgentRuntimeStatusCompletedPayload,
  AgentRuntimeStatusFailedPayload,
  AgentSessionCatalogUpdatedPayload,
  AgentSessionImportCompletedPayload,
  AgentSessionImportFailedPayload,
  AgentSessionImportMessagePayload,
  AgentSessionImportStartedPayload,
  AgentSessionPreviewCompletedPayload,
  AgentSessionPreviewFailedPayload,
  AgentSessionPreviewMessagePayload,
  AgentSessionReadyPayload,
  ClaudeRuntimeMetrics,
  ClaudeRuntimePhase,
  ClaudeSessionCatalogUpdatedPayload as ClaudeCatalogPayload,
  ClaudeSessionImportCompletedPayload as ClaudeImportCompletedPayload,
  ClaudeSessionImportFailedPayload as ClaudeImportFailedPayload,
  ClaudeSessionImportMessagePayload as ClaudeImportMessagePayload,
  ClaudeSessionImportStartedPayload as ClaudeImportStartedPayload,
  ClaudeSessionPreviewCompletedPayload as ClaudePreviewCompletedPayload,
  ClaudeSessionPreviewFailedPayload as ClaudePreviewFailedPayload,
  ClaudeSessionPreviewMessagePayload as ClaudePreviewMessagePayload,
  ClaudeSessionReadyPayload as ClaudeReadyPayload
} from "@cacp/protocol";

export interface RoomClientInput {
  serverUrl: string;
  roomId: string;
  agentToken: string;
}

export class RoomClient {
  constructor(private readonly input: RoomClientInput) {}

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.input.serverUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.input.agentToken}` },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
    return await response.json() as T;
  }

  publishCatalog(payload: ClaudeCatalogPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-catalog`, payload);
  }

  publishAgentSessionCatalog(payload: AgentSessionCatalogUpdatedPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/agent-sessions/catalog`, payload);
  }

  publishSessionReady(payload: ClaudeReadyPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-ready`, payload);
  }

  publishAgentSessionReady(payload: AgentSessionReadyPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/agent-sessions/ready`, payload);
  }

  startImport(payload: ClaudeImportStartedPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-imports/start`, payload);
  }

  uploadImportMessages(importId: string, messages: ClaudeImportMessagePayload[]): Promise<{ ok: true; imported: number }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-imports/${importId}/messages`, messages);
  }

  completeImport(importId: string, payload: ClaudeImportCompletedPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-imports/${importId}/complete`, payload);
  }

  failImport(importId: string, payload: ClaudeImportFailedPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-imports/${importId}/fail`, payload);
  }

  uploadPreviewMessages(previewId: string, messages: ClaudePreviewMessagePayload[]): Promise<{ ok: true; previewed: number }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-previews/${previewId}/messages`, messages);
  }

  completePreview(previewId: string, payload: ClaudePreviewCompletedPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-previews/${previewId}/complete`, payload);
  }

  failPreview(previewId: string, payload: ClaudePreviewFailedPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-previews/${previewId}/fail`, payload);
  }

  publishRuntimeStatus(kind: "changed" | "completed" | "failed", payload: unknown): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/runtime-status`, { kind, payload });
  }

  publishAgentRuntimeStatus(kind: "changed" | "completed" | "failed", payload: unknown): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/agent-runtime/status`, { kind, payload });
  }

  startAgentImport(payload: AgentSessionImportStartedPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/agent-sessions/imports/start`, payload);
  }

  uploadAgentImportMessages(importId: string, messages: AgentSessionImportMessagePayload[]): Promise<{ ok: true; imported: number }> {
    return this.postJson(`/rooms/${this.input.roomId}/agent-sessions/imports/${importId}/messages`, messages);
  }

  completeAgentImport(importId: string, payload: AgentSessionImportCompletedPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/agent-sessions/imports/${importId}/complete`, payload);
  }

  failAgentImport(importId: string, payload: AgentSessionImportFailedPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/agent-sessions/imports/${importId}/fail`, payload);
  }

  uploadAgentPreviewMessages(previewId: string, messages: AgentSessionPreviewMessagePayload[]): Promise<{ ok: true; previewed: number }> {
    return this.postJson(`/rooms/${this.input.roomId}/agent-sessions/previews/${previewId}/messages`, messages);
  }

  completeAgentPreview(previewId: string, payload: AgentSessionPreviewCompletedPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/agent-sessions/previews/${previewId}/complete`, payload);
  }

  failAgentPreview(previewId: string, payload: AgentSessionPreviewFailedPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/agent-sessions/previews/${previewId}/fail`, payload);
  }

  startTurn(turnId: string): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/agent-turns/${turnId}/start`, {});
  }

  publishTurnDelta(turnId: string, chunk: string): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/agent-turns/${turnId}/delta`, { chunk });
  }

  completeTurn(turnId: string, finalText: string): Promise<{ ok: true; message_id: string }> {
    return this.postJson(`/rooms/${this.input.roomId}/agent-turns/${turnId}/complete`, { final_text: finalText, exit_code: 0 });
  }

  failTurn(turnId: string, error: string): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/agent-turns/${turnId}/fail`, { error });
  }
}

export function statusSummary(input: { elapsedMs: number; metrics: ClaudeRuntimeMetrics }): string {
  const seconds = Math.max(1, Math.round(input.elapsedMs / 1000));
  const parts = [`Completed in ${seconds}s`];
  if (input.metrics.files_read) parts.push(`read ${input.metrics.files_read} files`);
  if (input.metrics.searches) parts.push(`searched ${input.metrics.searches} times`);
  if (input.metrics.commands) parts.push(`ran ${input.metrics.commands} commands`);
  return parts.join(" · ");
}

export function runtimePhaseFromToolName(toolName: string): ClaudeRuntimePhase {
  if (toolName === "Read" || toolName === "LS") return "reading_files";
  if (toolName === "Grep" || toolName === "Glob") return "searching";
  if (toolName === "Bash") return "running_command";
  return "thinking";
}
