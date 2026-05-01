import type { AgentRuntimeMetrics, AgentRuntimePhase } from "@cacp/protocol";
import { loadCodexSdk } from "./codex-sdk.js";
import type { CodexRuntimeInput, CodexRuntimeStatus, CodexThread, CodexThreadEvent, CodexTurnInput, CodexTurnResult } from "./types.js";
import { toCodexThreadOptions } from "./types.js";

function computeTextDelta(previous: string, next: string): string {
  if (!previous) return next;
  if (next.startsWith(previous)) return next.slice(previous.length);
  return next;
}

function promptForTurn(input: CodexTurnInput, permissionLevel: string): string {
  return [
    "CACP room message",
    `Room: ${input.roomName ?? "Untitled room"}`,
    `Speaker: ${input.speakerName} (${input.speakerRole})`,
    `Mode: ${input.modeLabel}`,
    `Message: ${input.text}`,
    "Safety/permission:",
    `- Current CACP permission level: ${permissionLevel}. Follow Codex CLI sandbox settings and the CACP room policy for this turn.`,
    "- Do not run commands or modify files beyond the active permission mode or an explicit owner instruction.",
    "- Do not reveal hidden chain-of-thought; share concise observable reasoning, actions, and results.",
    "Instruction: Continue from the current Codex thread context and answer for the room."
  ].join("\n");
}

export class CodexRuntime {
  private sdk: CodexRuntimeInput["sdk"] | undefined;
  private sdkPromise: Promise<NonNullable<CodexRuntimeInput["sdk"]>>;
  private agentId: string;
  private workingDir: string;
  private permissionLevel: string;
  private model?: string;
  private publishStatus: CodexRuntimeInput["publishStatus"];
  private publishDelta: CodexRuntimeInput["publishDelta"];
  private thread: CodexThread | undefined;
  private sessionId: string | undefined;
  private activeAbortController: AbortController | undefined;

  constructor(input: CodexRuntimeInput) {
    this.sdk = input.sdk;
    this.sdkPromise = Promise.resolve(input.sdk ?? loadCodexSdk());
    this.agentId = input.agentId;
    this.workingDir = input.workingDir;
    this.permissionLevel = input.permissionLevel;
    this.model = input.model;
    this.publishStatus = input.publishStatus;
    this.publishDelta = input.publishDelta;
  }

  async selectSession(selection: { mode: "fresh" } | { mode: "resume"; sessionId: string }): Promise<void> {
    const sdk = await this.sdkPromise;
    const options = toCodexThreadOptions({ workingDir: this.workingDir, permissionLevel: this.permissionLevel, model: this.model });
    if (selection.mode === "fresh") {
      this.thread = sdk.startThread(options);
      this.sessionId = this.thread.id ?? undefined;
    } else {
      this.thread = sdk.resumeThread(selection.sessionId, options);
      this.sessionId = selection.sessionId;
    }
  }

  async runTurn(input: CodexTurnInput): Promise<CodexTurnResult> {
    if (!this.thread) {
      throw new Error("codex_session_not_selected");
    }

    const metrics: AgentRuntimeMetrics = { files_read: 0, searches: 0, commands: 0 };
    const recent: string[] = [];
    let phase: AgentRuntimePhase = "thinking";
    let current = "Thinking...";
    let finalText = "";
    let previousText = "";
    let sessionId = this.sessionId;

    function pushRecent(text: string) {
      recent.push(text);
      if (recent.length > 10) recent.shift();
    }

    const publish = async (turnId: string, statusPhase: AgentRuntimePhase, statusCurrent: string) => {
      await this.publishStatus(turnId, {
        phase: statusPhase,
        current: statusCurrent,
        recent: [...recent],
        metrics: { ...metrics }
      });
    };

    const prompt = promptForTurn(input, this.permissionLevel);
    const abortController = new AbortController();
    this.activeAbortController = abortController;
    try {
      const { events } = await this.thread.runStreamed(prompt, { signal: abortController.signal });

      for await (const event of events) {
        switch (event.type) {
          case "thread.started": {
            sessionId = event.thread_id;
            this.sessionId = event.thread_id;
            break;
          }
          case "turn.started": {
            phase = "thinking";
            current = "Thinking...";
            await publish(input.turnId, phase, current);
            break;
          }
          case "item.started": {
            const item = event.item ?? {};
            if (item.type === "command_execution") {
              phase = "running_command";
              current = `Codex running command: ${item.command ?? ""}`;
              metrics.commands++;
              pushRecent(current);
              await publish(input.turnId, phase, current);
            }
            break;
          }
          case "item.completed": {
            const item = event.item ?? {};
            if (item.type === "agent_message" && typeof item.text === "string") {
              const text = item.text;
              const delta = computeTextDelta(previousText, text);
              if (delta) {
                await this.publishDelta(input.turnId, delta);
              }
              finalText = text;
              previousText = text;
            }
            break;
          }
          case "turn.completed": {
            phase = "completed";
            current = finalText || "Completed";
            await publish(input.turnId, phase, current);
            return { finalText, sessionId, metrics };
          }
          case "turn.failed": {
            phase = "failed";
            current = event.error?.message ?? "Turn failed";
            pushRecent(current);
            await publish(input.turnId, phase, current);
            throw new Error(current);
          }
          case "error": {
            phase = "failed";
            current = event.message ?? "Unknown error";
            pushRecent(current);
            await publish(input.turnId, phase, current);
            throw new Error(current);
          }
        }
      }

      // If we reach here without turn.completed, return what we have
      return { finalText, sessionId, metrics };
    } finally {
      if (this.activeAbortController === abortController) {
        this.activeAbortController = undefined;
      }
    }
  }

  async close(): Promise<void> {
    this.activeAbortController?.abort();
  }
}
