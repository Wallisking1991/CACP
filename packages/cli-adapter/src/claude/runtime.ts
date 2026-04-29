import type { ClaudeRuntimeMetrics, ClaudeRuntimePhase } from "@cacp/protocol";
import { loadClaudeSdk } from "./claude-sdk.js";
import type { ClaudePersistentSession, ClaudeRuntimeStatus, ClaudeSdk, ClaudeSdkSessionOptions } from "./types.js";
import { toClaudeSdkSessionOptions } from "./types.js";

export interface ClaudeTurnInput {
  turnId: string;
  roomName?: string;
  speakerName: string;
  speakerRole: string;
  modeLabel: string;
  text: string;
}

export interface ClaudeRuntimeInput {
  sdk?: Pick<ClaudeSdk, "createSession" | "resumeSession">;
  agentId: string;
  workingDir: string;
  permissionMode: string;
  model: string;
  publishStatus(turnId: string, status: ClaudeRuntimeStatus): Promise<void>;
  publishDelta(turnId: string, chunk: string): Promise<void>;
}

export interface ClaudeTurnResult {
  finalText: string;
  sessionId?: string;
  metrics: ClaudeRuntimeMetrics;
}

function nowIso(): string {
  return new Date().toISOString();
}

function trimRecent(recent: string[]): string[] {
  return recent.slice(-10);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function extractTextFromMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => {
      const record = asRecord(item);
      if (typeof record.text === "string") return record.text;
      if (typeof record.content === "string") return record.content;
      return "";
    }).filter(Boolean).join("");
  }
  const record = asRecord(content);
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  if (Array.isArray(record.content)) return extractTextFromMessageContent(record.content);
  return "";
}

function extractTextFromStreamMessage(raw: unknown): string {
  const record = asRecord(raw);
  const message = record.message ?? record.content ?? raw;
  return extractTextFromMessageContent(message);
}

function contentBlocksFromStreamMessage(raw: unknown): Record<string, unknown>[] {
  const record = asRecord(raw);
  const message = asRecord(record.message);
  const content = message.content ?? record.content;
  if (!Array.isArray(content)) return [];
  return content.map(asRecord);
}

function describeToolTarget(tool: Record<string, unknown>): string {
  const input = asRecord(tool.input);
  const filePath = typeof input.file_path === "string" ? input.file_path : typeof input.path === "string" ? input.path : "";
  const pattern = typeof input.pattern === "string" ? input.pattern : "";
  const command = typeof input.command === "string" ? input.command : "";
  return filePath || pattern || command;
}

function promptForTurn(input: ClaudeTurnInput, permissionMode: string): string {
  return [
    "CACP room message",
    `Room: ${input.roomName ?? "Untitled room"}`,
    `Speaker: ${input.speakerName} (${input.speakerRole})`,
    `Mode: ${input.modeLabel}`,
    `Message: ${input.text}`,
    "Safety/permission:",
    `- Current permission mode: ${permissionMode}. Follow Claude Code SDK permission enforcement and the CACP room policy for this turn.`,
    "- Do not run commands or modify files beyond the active permission mode or an explicit owner instruction.",
    "- Do not reveal hidden chain-of-thought; share concise observable reasoning, actions, and results.",
    "Instruction: Continue from the current Claude Code session context and answer for the room."
  ].join("\n");
}

export class ClaudeRuntime {
  private session: ClaudePersistentSession | undefined;
  private readonly sdkPromise: Promise<Pick<ClaudeSdk, "createSession" | "resumeSession">>;

  constructor(private readonly input: ClaudeRuntimeInput) {
    this.sdkPromise = Promise.resolve(input.sdk ?? loadClaudeSdk());
  }

  async selectSession(selection: { mode: "fresh" } | { mode: "resume"; sessionId: string }): Promise<string | undefined> {
    const sdk = await this.sdkPromise;
    if (this.session) {
      await this.session.close();
      this.session = undefined;
    }
    const sdkOptions: Omit<ClaudeSdkSessionOptions, "sessionId"> = {
      workingDir: this.input.workingDir,
      model: this.input.model,
      settingSources: ["user", "project", "local"],
      includePartialMessages: true,
      ...toClaudeSdkSessionOptions(this.input.permissionMode)
    };
    if (selection.mode === "fresh") {
      this.session = await sdk.createSession(sdkOptions);
      return this.session.sessionId;
    }
    this.session = await sdk.resumeSession({
      ...sdkOptions,
      sessionId: selection.sessionId
    });
    return this.session.sessionId;
  }

  async runTurn(turn: ClaudeTurnInput): Promise<ClaudeTurnResult> {
    if (!this.session) {
      throw new Error("claude_session_not_selected");
    }
    const started = Date.now();
    const recent: string[] = [];
    const metrics: ClaudeRuntimeMetrics = { files_read: 0, searches: 0, commands: 0 };
    const publish = async (phase: ClaudeRuntimePhase, current: string) => {
      recent.push(current);
      await this.input.publishStatus(turn.turnId, {
        phase,
        current,
        recent: trimRecent(recent),
        metrics
      });
    };
    const publishToolUse = async (tool: Record<string, unknown>) => {
      const toolName = typeof tool.name === "string" ? tool.name : "";
      const target = describeToolTarget(tool);
      const suffix = target ? `: ${toolName} ${target}` : toolName ? `: ${toolName}` : "";
      if (toolName === "Read" || toolName === "LS") {
        metrics.files_read += 1;
        await publish("reading_files", `Claude Code reading files${suffix}`);
      } else if (toolName === "Grep" || toolName === "Glob") {
        metrics.searches += 1;
        await publish("searching", `Claude Code searching${suffix}`);
      } else if (toolName === "Bash") {
        metrics.commands += 1;
        await publish("running_command", `Claude Code running command${suffix}`);
      } else {
        await publish("thinking", toolName ? `Claude Code using tool: ${toolName}` : "Claude Code is thinking");
      }
    };

    await publish(this.session?.sessionId ? "resuming_session" : "connecting", this.session?.sessionId ? `Using Claude session ${this.session.sessionId}` : "Starting Claude session");
    await publish("thinking", "Sending room message to Claude Code");

    await this.session!.send(promptForTurn(turn, this.input.permissionMode));

    let finalText = "";
    for await (const rawMessage of this.session!.stream()) {
      const record = asRecord(rawMessage);
      const msgType = typeof record.type === "string" ? record.type : "";

      if (msgType === "assistant") {
        const text = extractTextFromStreamMessage(rawMessage);
        if (text) {
          finalText += text;
          await this.input.publishDelta(turn.turnId, text);
          await publish("generating_answer", "Claude Code is generating an answer");
        }
        for (const block of contentBlocksFromStreamMessage(rawMessage)) {
          if (block.type === "tool_use") {
            await publishToolUse(block);
          }
        }
      } else if (msgType === "tool_use") {
        await publishToolUse(record);
      } else if (msgType === "tool_result") {
        const resultText = extractTextFromStreamMessage(rawMessage);
        if (resultText) {
          await publish("thinking", `Tool result: ${resultText.slice(0, 200)}`);
        }
      } else if (msgType === "system") {
        const subtype = typeof record.subtype === "string" ? record.subtype : "";
        const state = typeof record.state === "string" ? record.state : "";
        if (subtype === "session_state_changed" && state === "idle") {
          break;
        }
        const sysRecord = asRecord(record.message);
        const phase = typeof sysRecord.phase === "string" ? sysRecord.phase : "";
        const current = typeof sysRecord.current === "string" ? sysRecord.current : "";
        if (phase === "reading_files") {
          metrics.files_read += 1;
          await publish("reading_files", current || "Claude Code reading files");
        } else if (phase === "searching") {
          metrics.searches += 1;
          await publish("searching", current || "Claude Code searching");
        } else if (phase === "running_command") {
          metrics.commands += 1;
          await publish("running_command", current || "Claude Code running command");
        } else if (phase === "waiting_for_approval") {
          await publish("waiting_for_approval", current || "Claude Code waiting for approval");
        } else if (current) {
          await publish("thinking", current);
        }
      } else if (msgType === "session_state_changed") {
        const state = typeof record.state === "string" ? record.state : "";
        if (state === "idle") {
          break;
        }
        if (state) {
          await publish("thinking", `Claude session state: ${state}`);
        }
      } else if (msgType === "stream_event" || msgType === "tool_progress" || msgType === "tool_use_summary") {
        const text = extractTextFromStreamMessage(rawMessage);
        if (text) {
          await publish("thinking", text.slice(0, 200));
        }
      } else if (msgType === "error" || msgType === "failed") {
        const errorText = typeof record.message === "string" ? record.message : typeof record.error === "string" ? record.error : "Claude Code encountered an error";
        await publish("failed", errorText);
        throw new Error(errorText);
      }
    }

    await publish("completed", `Claude Code completed in ${Math.max(1, Math.round((Date.now() - started) / 1000))}s`);
    return { finalText, sessionId: this.session?.sessionId, metrics };
  }

  async close(): Promise<void> {
    if (this.session) await this.session.close();
  }
}
