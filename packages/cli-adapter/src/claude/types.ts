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
  send(prompt: string, callbacks: ClaudeRuntimeCallbacks): Promise<string>;
  close(): Promise<void>;
}

export interface ClaudeSdkSessionMessage {
  id?: string;
  role?: string;
  type?: string;
  content?: unknown;
  timestamp?: string;
  created_at?: string;
}

export interface ClaudeSdkSessionSummary {
  id?: string;
  session_id?: string;
  title?: string;
  updated_at?: string;
  message_count?: number;
  byte_size?: number;
  project_dir?: string;
  cwd?: string;
}

export interface ClaudeSdk {
  createSession(input: { workingDir: string; systemPrompt?: string; permissionLevel: string }): Promise<ClaudePersistentSession>;
  resumeSession(input: { workingDir: string; sessionId: string; systemPrompt?: string; permissionLevel: string }): Promise<ClaudePersistentSession>;
  listSessions(input: { workingDir: string }): Promise<ClaudeSdkSessionSummary[]>;
  getSessionMessages(input: { workingDir: string; sessionId: string }): Promise<ClaudeSdkSessionMessage[]>;
}
