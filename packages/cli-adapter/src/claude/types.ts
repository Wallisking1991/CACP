import type {
  ClaudeRuntimeMetrics,
  ClaudeRuntimePhase,
  ClaudeSessionImportMessagePayload,
  ClaudeSessionSummary
} from "@cacp/protocol";

export interface ClaudeSessionCatalogInput {
  workingDir: string;
  homeDir?: string;
}

export interface ClaudeSessionCatalogResult {
  workingDir: string;
  sessions: ClaudeSessionSummary[];
}

export interface ClaudeImportedMessage extends ClaudeSessionImportMessagePayload {}

export interface ClaudeImportResult {
  importId: string;
  sessionId: string;
  title: string;
  messages: ClaudeImportedMessage[];
}

export interface ClaudeRuntimeStatus {
  phase: ClaudeRuntimePhase;
  current: string;
  recent: string[];
  metrics: ClaudeRuntimeMetrics;
}

export interface ClaudeRuntimeCallbacks {
  onStatus(status: ClaudeRuntimeStatus): Promise<void>;
  onDelta(chunk: string): Promise<void>;
}

export interface ClaudePersistentSession {
  sessionId: string | undefined;
  send(prompt: string): Promise<void>;
  stream(): AsyncIterable<unknown>;
  close(): Promise<void>;
}

export interface ClaudeSdkSessionMessage {
  uuid?: string;
  type?: string;
  message?: unknown;
}

export interface ClaudeSdkSessionSummary {
  sessionId?: string;
  summary?: string;
  lastModified?: string;
  fileSize?: number;
  cwd?: string;
}

export interface ClaudeSdk {
  createSession(input: { workingDir: string; systemPrompt?: string; permissionLevel: string }): Promise<ClaudePersistentSession>;
  resumeSession(input: { workingDir: string; sessionId: string; systemPrompt?: string; permissionLevel: string }): Promise<ClaudePersistentSession>;
  listSessions(input: { dir: string }): Promise<ClaudeSdkSessionSummary[]>;
  getSessionMessages(sessionId: string, input: { dir: string }): Promise<ClaudeSdkSessionMessage[]>;
}
