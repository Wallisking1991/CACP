export interface CodexSdk {
  startThread(options: CodexThreadOptions): CodexThread;
  resumeThread(id: string, options: CodexThreadOptions): CodexThread;
}

export interface CodexThread {
  id: string | null;
  runStreamed(input: string, options?: { signal?: AbortSignal }): Promise<{ events: AsyncGenerator<CodexThreadEvent> }>;
}

export type CodexThreadOptions = {
  model?: string;
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  modelReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  networkAccessEnabled?: boolean;
  webSearchMode?: "disabled" | "cached" | "live";
  approvalPolicy?: "never" | "on-request" | "on-failure" | "untrusted";
  additionalDirectories?: string[];
};

export type CodexThreadEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.started" }
  | { type: "turn.completed"; usage: unknown }
  | { type: "turn.failed"; error: { message: string } }
  | { type: "item.started"; item: CodexThreadItem }
  | { type: "item.updated"; item: CodexThreadItem }
  | { type: "item.completed"; item: CodexThreadItem }
  | { type: "error"; message: string };

export interface CodexThreadItem {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number;
  status?: string;
  [key: string]: unknown;
}

export interface CodexTurnInput {
  turnId: string;
  roomName?: string;
  speakerName: string;
  speakerRole: string;
  modeLabel: string;
  text: string;
}

export interface CodexTurnResult {
  finalText: string;
  sessionId?: string;
  metrics: { files_read: number; searches: number; commands: number };
}

export interface CodexRuntimeStatus {
  phase: string;
  current: string;
  recent: string[];
  metrics: { files_read: number; searches: number; commands: number };
}

export interface CodexRuntimeInput {
  sdk: CodexSdk;
  agentId: string;
  workingDir: string;
  permissionLevel: string;
  model?: string;
  publishStatus: (turnId: string, status: CodexRuntimeStatus) => Promise<void>;
  publishDelta: (turnId: string, chunk: string) => Promise<void>;
}

export function toCodexThreadOptions(input: { workingDir: string; permissionLevel: string; model?: string }): CodexThreadOptions {
  const sandboxMode: CodexThreadOptions["sandboxMode"] =
    input.permissionLevel === "read_only"
      ? "read-only"
      : input.permissionLevel === "limited_write"
        ? "workspace-write"
        : "danger-full-access";

  return {
    model: input.model,
    workingDirectory: input.workingDir,
    skipGitRepoCheck: true,
    sandboxMode,
    approvalPolicy: "never",
    webSearchMode: "disabled",
    networkAccessEnabled: input.permissionLevel === "full_access"
  };
}
