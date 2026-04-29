import type { ClaudeRuntimeMetrics, ClaudeRuntimePhase } from "@cacp/protocol";
import { loadClaudeSdk } from "./claude-sdk.js";
import type { ClaudePersistentSession, ClaudeRuntimeStatus, ClaudeSdk } from "./types.js";

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
  permissionLevel: string;
  systemPrompt?: string;
  publishStatus(turnId: string, status: ClaudeRuntimeStatus): Promise<void>;
  publishDelta(turnId: string, chunk: string): Promise<void>;
}

export interface ClaudeTurnResult {
  finalText: string;
  sessionId?: string;
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
  return "";
}

function extractTextFromStreamMessage(raw: unknown): string {
  const record = asRecord(raw);
  const message = record.message ?? record.content ?? raw;
  return extractTextFromMessageContent(message);
}

function promptForTurn(input: ClaudeTurnInput): string {
  return [
    "CACP room message",
    `Room: ${input.roomName ?? "Untitled room"}`,
    `Speaker: ${input.speakerName} (${input.speakerRole})`,
    `Mode: ${input.modeLabel}`,
    `Message: ${input.text}`,
    "Instruction: Continue from the current Claude Code session context and answer for the room."
  ].join("\n");
}

export class ClaudeRuntime {
  private session: ClaudePersistentSession | undefined;
  private readonly sdkPromise: Promise<Pick<ClaudeSdk, "createSession" | "resumeSession">>;

  constructor(private readonly input: ClaudeRuntimeInput) {
    this.sdkPromise = Promise.resolve(input.sdk ?? loadClaudeSdk());
  }

  async selectSession(selection: { mode: "fresh" } | { mode: "resume"; sessionId: string }): Promise<void> {
    const sdk = await this.sdkPromise;
    if (this.session) {
      await this.session.close();
      this.session = undefined;
    }
    if (selection.mode === "fresh") {
      this.session = await sdk.createSession({
        workingDir: this.input.workingDir,
        permissionLevel: this.input.permissionLevel,
        systemPrompt: this.input.systemPrompt
      });
      return;
    }
    this.session = await sdk.resumeSession({
      workingDir: this.input.workingDir,
      sessionId: selection.sessionId,
      permissionLevel: this.input.permissionLevel,
      systemPrompt: this.input.systemPrompt
    });
  }

  async runTurn(turn: ClaudeTurnInput): Promise<ClaudeTurnResult> {
    if (!this.session) {
      await this.selectSession({ mode: "fresh" });
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

    await publish(this.session?.sessionId ? "resuming_session" : "connecting", this.session?.sessionId ? `Using Claude session ${this.session.sessionId}` : "Starting Claude session");
    await publish("thinking", "Sending room message to Claude Code");

    await this.session!.send(promptForTurn(turn));

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
      } else if (msgType === "tool_use") {
        const toolName = typeof record.name === "string" ? record.name : "";
        if (toolName === "Read" || toolName === "LS") metrics.files_read += 1;
        if (toolName === "Grep" || toolName === "Glob") metrics.searches += 1;
        if (toolName === "Bash") metrics.commands += 1;
        await publish("thinking", toolName ? `Claude Code using tool: ${toolName}` : "Claude Code is thinking");
      } else if (msgType === "system") {
        const sysRecord = asRecord(record.message);
        const phase = typeof sysRecord.phase === "string" ? sysRecord.phase : "";
        const current = typeof sysRecord.current === "string" ? sysRecord.current : "";
        if (current) await publish("thinking", current);
        if (phase) {
          if (phase === "reading_files") metrics.files_read += 1;
          if (phase === "searching") metrics.searches += 1;
          if (phase === "running_command") metrics.commands += 1;
        }
      }
    }

    await publish("completed", `Claude Code completed in ${Math.max(1, Math.round((Date.now() - started) / 1000))}s`);
    return { finalText, sessionId: this.session?.sessionId };
  }

  async close(): Promise<void> {
    if (this.session) await this.session.close();
  }
}
