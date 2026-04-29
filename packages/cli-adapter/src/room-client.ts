import type {
  ClaudeRuntimeMetrics,
  ClaudeRuntimePhase,
  ClaudeSessionCatalogUpdatedPayload,
  ClaudeSessionImportCompletedPayload,
  ClaudeSessionImportFailedPayload,
  ClaudeSessionImportMessagePayload,
  ClaudeSessionImportStartedPayload,
  ClaudeSessionPreviewCompletedPayload,
  ClaudeSessionPreviewFailedPayload,
  ClaudeSessionPreviewMessagePayload,
  ClaudeSessionReadyPayload
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

  publishCatalog(payload: ClaudeSessionCatalogUpdatedPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-catalog`, payload);
  }

  publishSessionReady(payload: ClaudeSessionReadyPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-ready`, payload);
  }

  startImport(payload: ClaudeSessionImportStartedPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-imports/start`, payload);
  }

  uploadImportMessages(importId: string, messages: ClaudeSessionImportMessagePayload[]): Promise<{ ok: true; imported: number }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-imports/${importId}/messages`, messages);
  }

  completeImport(importId: string, payload: ClaudeSessionImportCompletedPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-imports/${importId}/complete`, payload);
  }

  failImport(importId: string, payload: ClaudeSessionImportFailedPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-imports/${importId}/fail`, payload);
  }

  uploadPreviewMessages(previewId: string, messages: ClaudeSessionPreviewMessagePayload[]): Promise<{ ok: true; previewed: number }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-previews/${previewId}/messages`, messages);
  }

  completePreview(previewId: string, payload: ClaudeSessionPreviewCompletedPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-previews/${previewId}/complete`, payload);
  }

  failPreview(previewId: string, payload: ClaudeSessionPreviewFailedPayload): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/session-previews/${previewId}/fail`, payload);
  }

  publishRuntimeStatus(kind: "changed" | "completed" | "failed", payload: unknown): Promise<{ ok: true }> {
    return this.postJson(`/rooms/${this.input.roomId}/claude/runtime-status`, { kind, payload });
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
