import type {
  ClaudeRuntimeMetrics,
  ClaudeRuntimePhase,
  ClaudeSessionImportMessagePayload,
  ClaudeSessionPreviewMessagePayload,
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
export interface ClaudePreviewedMessage extends ClaudeSessionPreviewMessagePayload {}

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
  lastModified?: number;
  fileSize?: number;
  cwd?: string;
}

export type ClaudeSdkPermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto";
export type ClaudeSdkSettingSource = "user" | "project" | "local";

export interface ClaudeSdkSessionOptions {
  workingDir: string;
  sessionId?: string;
  permissionMode: ClaudeSdkPermissionMode;
  model: string;
  settingSources?: ClaudeSdkSettingSource[];
  allowedTools?: string[];
  disallowedTools?: string[];
  allowDangerouslySkipPermissions?: boolean;
  includePartialMessages?: boolean;
}

export function toClaudeSdkSessionOptions(cacpLevel: string): Pick<ClaudeSdkSessionOptions, "permissionMode" | "allowedTools" | "disallowedTools" | "allowDangerouslySkipPermissions"> {
  if (cacpLevel === "read_only") {
    return {
      permissionMode: "dontAsk",
      allowedTools: ["Read", "Glob", "Grep", "LS"]
    };
  }
  if (cacpLevel === "limited_write") {
    return {
      permissionMode: "dontAsk",
      allowedTools: ["Read", "Glob", "Grep", "LS", "Edit", "MultiEdit", "Write"],
      disallowedTools: ["Bash"]
    };
  }
  if (cacpLevel === "full_access") {
    return {
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true
    };
  }
  return { permissionMode: "default" };
}

export interface ClaudeSdk {
  createSession(input: ClaudeSdkSessionOptions): Promise<ClaudePersistentSession>;
  resumeSession(input: ClaudeSdkSessionOptions): Promise<ClaudePersistentSession>;
  listSessions(input: { dir: string }): Promise<ClaudeSdkSessionSummary[]>;
  getSessionMessages(sessionId: string, input: { dir: string; includeSystemMessages?: boolean }): Promise<ClaudeSdkSessionMessage[]>;
}
