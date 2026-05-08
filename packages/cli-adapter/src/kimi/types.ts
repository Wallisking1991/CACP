import type {
  AgentRunApprovalRequestBody,
  AgentRunMetrics,
  AgentRunNodeCompletedPayload,
  AgentRunNodeDeltaPayload,
  AgentRunNodeFailedPayload,
  AgentRunNodeStartedPayload,
  AgentRunNodeUpdatedPayload
} from "@cacp/protocol";

export interface KimiRuntimeInput {
  agentId: string;
  agentName?: string;
  workingDir: string;
  permissionLevel?: string;
  model?: string;
  thinking?: boolean;
  sdk?: KimiSdk;
  turnId?: string;
  text?: string;
  speakerName?: string;
  speakerRole?: string;
  modeLabel?: string;
  roomName?: string;
  publishDelta: (turnId: string, delta: string) => Promise<void>;
  startNode: (payload: AgentRunNodeStartedPayload) => Promise<void>;
  appendNodeDelta: (payload: AgentRunNodeDeltaPayload) => Promise<void>;
  updateNode: (payload: AgentRunNodeUpdatedPayload) => Promise<void>;
  completeNode: (payload: AgentRunNodeCompletedPayload) => Promise<void>;
  failNode: (payload: AgentRunNodeFailedPayload) => Promise<void>;
  requestApproval: (nodeId: string, payload: AgentRunApprovalRequestBody) => Promise<{ decision: "allow" | "deny"; resolved_by: string; resolved_at: string; reason?: string }>;
}

export interface KimiTurnResult {
  finalText: string;
  sessionId: string | undefined;
  metrics: AgentRunMetrics;
}

export interface KimiSdk {
  createSession(options: {
    workDir: string;
    sessionId?: string;
    model?: string;
    thinking?: boolean;
    yoloMode?: boolean;
    executable?: string;
    env?: Record<string, string>;
  }): KimiSdkSession;
  listSessions(workDir: string): Promise<KimiSdkSessionInfo[]>;
  parseSessionEvents(workDir: string, sessionId: string): Promise<unknown[]>;
}

export interface KimiSdkSession {
  readonly sessionId: string;
  readonly workDir: string;
  readonly state: "idle" | "active" | "closed";
  model: string | undefined;
  thinking: boolean;
  yoloMode: boolean;
  executable: string;
  env: Record<string, string>;
  prompt(content: string | unknown[]): KimiSdkTurn;
  close(): Promise<void>;
}

export interface KimiSdkTurn {
  [Symbol.asyncIterator](): AsyncIterator<KimiSdkStreamEvent, { status: "finished" | "cancelled" | "max_steps_reached"; steps?: number }, undefined>;
  interrupt(): Promise<void>;
  approve(requestId: string, response: "approve" | "approve_for_session" | "reject"): Promise<void>;
  readonly result: Promise<{ status: "finished" | "cancelled" | "max_steps_reached"; steps?: number }>;
}

export interface KimiSdkSessionInfo {
  id: string;
  workDir: string;
  contextFile: string;
  updatedAt: number;
  brief: string;
}

export type KimiSdkStreamEvent =
  | { type: "TurnBegin"; payload: { user_input: string | unknown[] } }
  | { type: "StepBegin"; payload: { n: number } }
  | { type: "StepInterrupted"; payload: Record<string, never> }
  | { type: "ContentPart"; payload: { type: "text"; text: string } | { type: "think"; think: string; encrypted?: string | null } }
  | { type: "ToolCall"; payload: { type: "function"; id: string; function: { name: string; arguments: string | null }; extras?: Record<string, unknown> | null } }
  | { type: "ToolCallPart"; payload: { arguments_part: string } }
  | { type: "ToolResult"; payload: { tool_call_id: string; return_value: { is_error: boolean; output: string | unknown[]; message: string; display: unknown[]; extras?: Record<string, unknown> | null } } }
  | { type: "StatusUpdate"; payload: { token_usage?: { input_other: number; output: number }; context_usage?: number } }
  | { type: "CompactionBegin"; payload: Record<string, never> }
  | { type: "CompactionEnd"; payload: Record<string, never> }
  | { type: "ApprovalRequest"; payload: { id: string; action: string; description: string } }
  | { type: "SubagentEvent"; payload: { parent_tool_call_id: string; event: unknown } };
