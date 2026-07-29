import type {
  CanUseTool as ClaudeSdkCanUseTool,
  ElicitationRequest as ClaudeSdkElicitationRequest,
  ElicitationResult as ClaudeSdkElicitationResult,
  OnElicitation as ClaudeSdkOnElicitation,
  PermissionMode as ClaudeSdkPermissionMode,
  PermissionResult as ClaudeSdkPermissionResult,
  SDKSessionInfo as ClaudeSdkSessionSummary,
  SettingSource as ClaudeSdkSettingSource,
  ToolConfig as ClaudeSdkToolConfig,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentRunApprovalRequestBody,
  AgentRunElicitationRequestBody,
  AgentRunMetrics,
  AgentRunNodeCompletedPayload,
  AgentRunNodeDeltaPayload,
  AgentRunNodeFailedPayload,
  AgentRunNodeStartedPayload,
  AgentRunNodeUpdatedPayload,
  ClaudeSessionImportMessagePayload,
  ClaudeSessionPreviewMessagePayload,
  ClaudeSessionSummary,
} from "@cacp/protocol";

export type { ClaudeSdkSessionSummary };

// Keep the boundary limited to the fields the connector reads. Newer Claude
// SDK releases add required bookkeeping fields to SessionMessage, but those
// fields are irrelevant to cataloging and transcript import.
export interface ClaudeSdkSessionMessage {
  uuid?: string;
  type?: string;
  message: unknown;
  session_id?: string;
  parent_tool_use_id?: string | null;
  parent_agent_id?: string | null;
}

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

export interface ClaudeQueryOptions {
  cwd: string;
  model: string;
  permissionMode?: ClaudeSdkPermissionMode;
  settingSources?: ClaudeSdkSettingSource[];
  includePartialMessages?: boolean;
  includeHookEvents?: boolean;
  forwardSubagentText?: boolean;
  toolConfig?: ClaudeSdkToolConfig;
  resume?: string;
  sessionId?: string;
  canUseTool?: ClaudeSdkCanUseTool;
  onElicitation?: ClaudeSdkOnElicitation;
  pathToClaudeCodeExecutable?: string;
}

export interface ClaudeQueryInput {
  prompt: string | AsyncIterable<ClaudeSdkUserMessage>;
  options: ClaudeQueryOptions;
}

export interface ClaudeSdkUserMessage {
  type: "user";
  message: {
    role: "user";
    content: unknown[];
  };
  parent_tool_use_id: null;
}

export type ClaudeQuery = AsyncIterable<unknown> & {
  close(): void;
};

export interface ClaudeSdk {
  query(input: ClaudeQueryInput): ClaudeQuery;
  listSessions(input: { dir: string }): Promise<ClaudeSdkSessionSummary[]>;
  getSessionMessages(
    sessionId: string,
    input: { dir: string; includeSystemMessages?: boolean }
  ): Promise<ClaudeSdkSessionMessage[]>;
}

export type ClaudePermissionResult = ClaudeSdkPermissionResult;
export type ClaudeElicitationRequest = ClaudeSdkElicitationRequest;
export type ClaudeElicitationResult = ClaudeSdkElicitationResult;
export type ClaudeRunMetrics = AgentRunMetrics;

export interface ClaudeApprovalDecision {
  decision: "allow" | "deny";
  resolved_by: string;
  resolved_at: string;
  reason?: string;
}

export interface ClaudeElicitationDecision {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
  resolved_by: string;
  resolved_at: string;
  reason?: string;
}

export interface ClaudeRunTraceSink {
  publishDelta(turnId: string, chunk: string): Promise<void>;
  startNode(payload: AgentRunNodeStartedPayload): Promise<void>;
  appendNodeDelta(payload: AgentRunNodeDeltaPayload): Promise<void>;
  updateNode(payload: AgentRunNodeUpdatedPayload): Promise<void>;
  completeNode(payload: AgentRunNodeCompletedPayload): Promise<void>;
  failNode(payload: AgentRunNodeFailedPayload): Promise<void>;
  requestApproval(
    nodeId: string,
    payload: AgentRunApprovalRequestBody
  ): Promise<ClaudeApprovalDecision>;
  requestElicitation(
    nodeId: string,
    payload: AgentRunElicitationRequestBody
  ): Promise<ClaudeElicitationDecision>;
}
