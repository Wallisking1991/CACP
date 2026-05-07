import type {
  AgentRunMetrics,
  AgentRunNodeCompletedPayload,
  AgentRunNodeDeltaPayload,
  AgentRunNodeFailedPayload,
  AgentRunNodeStartedPayload,
  AgentRunNodeUpdatedPayload
} from "@cacp/protocol";

export interface CopilotTurnInput {
  turnId: string;
  roomName?: string;
  speakerName: string;
  speakerRole: string;
  modeLabel: string;
  text: string;
}

export interface CopilotTurnResult {
  finalText: string;
  sessionId?: string;
  metrics: AgentRunMetrics;
  usage?: Record<string, unknown>;
}

export interface CopilotRunTraceSink {
  publishDelta(turnId: string, chunk: string): Promise<void>;
  startNode(payload: AgentRunNodeStartedPayload): Promise<void>;
  appendNodeDelta(payload: AgentRunNodeDeltaPayload): Promise<void>;
  updateNode(payload: AgentRunNodeUpdatedPayload): Promise<void>;
  completeNode(payload: AgentRunNodeCompletedPayload): Promise<void>;
  failNode(payload: AgentRunNodeFailedPayload): Promise<void>;
}

export interface CopilotRuntimeInput extends CopilotRunTraceSink {
  sdk?: CopilotSdk | Promise<CopilotSdk>;
  agentId: string;
  workingDir: string;
  permissionLevel: string;
  model?: string;
}

export interface CopilotSdkSession {
  sessionId: string;
  send(options: { prompt: string }): Promise<string>;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
  on(event: string, handler: (event: unknown) => void): () => void;
}

export interface CopilotSdkSessionSummary {
  sessionId: string;
  startTime: Date;
  modifiedTime: Date;
  summary?: string;
}

export interface CopilotSdk {
  createSession(config: {
    model?: string;
    onPermissionRequest: unknown;
    streaming?: boolean;
    workingDirectory?: string;
  }): Promise<CopilotSdkSession>;
  resumeSession(
    sessionId: string,
    config: { onPermissionRequest: unknown }
  ): Promise<CopilotSdkSession>;
  listSessions(): Promise<CopilotSdkSessionSummary[]>;
  start(): Promise<void>;
  stop(): Promise<Error[]>;
}
