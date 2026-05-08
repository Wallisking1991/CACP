import type { AgentRunMetrics } from "@cacp/protocol";
import { RunTraceRecorder } from "../run-trace.js";
import { findKimiCli, loadKimiSdk } from "./kimi-sdk.js";
import type { KimiRuntimeInput, KimiSdk, KimiSdkSession, KimiSdkStreamEvent, KimiTurnResult } from "./types.js";

function promptForTurn(input: { text: string; roomName?: string; speakerName: string; speakerRole: string; modeLabel: string }): string {
  return [
    "CACP room message",
    `Room: ${input.roomName ?? "Untitled room"}`,
    `Speaker: ${input.speakerName} (${input.speakerRole})`,
    `Mode: ${input.modeLabel}`,
    `Message: ${input.text}`,
    "Instruction: Continue from the current Kimi session context and answer for the room."
  ].join("\n");
}

function permissionHandlerForLevel(level: string): (request: { kind: string }) => { kind: string } {
  return (request: { kind: string }): { kind: string } => {
    const kind = request.kind;
    switch (level) {
      case "read_only":
        if (kind === "read") return { kind: "approved" };
        return { kind: "denied-interactively-by-user" };
      case "restricted":
        if (kind === "read" || kind === "url") return { kind: "approved" };
        return { kind: "denied-interactively-by-user" };
      case "default":
      default:
        return { kind: "approved" };
    }
  };
}

const ReadToolNames = new Set(["read_file", "view", "cat", "read", "open"]);
const SearchToolNames = new Set(["search", "grep", "find", "rg", "fd", "glob"]);

function metricKeyForToolName(toolName: string): keyof AgentRunMetrics | undefined {
  const normalized = toolName.toLowerCase().replace(/[-_]/g, "");
  if (ReadToolNames.has(normalized) || normalized.includes("read") || normalized.includes("view") || normalized.includes("cat")) return "files_read";
  if (SearchToolNames.has(normalized) || normalized.includes("search") || normalized.includes("grep") || normalized.includes("find")) return "searches";
  if (normalized.includes("command") || normalized.includes("shell") || normalized.includes("bash") || normalized.includes("exec")) return "commands";
  return undefined;
}

function toolTitle(toolName: string): string {
  return `Use ${toolName}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function textFromToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  const record = asRecord(result);
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  if (typeof record.output === "string") return record.output;
  if (typeof record.stdout === "string") return record.stdout;
  if (typeof record.result === "string") return record.result;
  return Object.keys(record).length > 0 ? JSON.stringify(record) : "";
}

export class KimiRuntime {
  private sdkPromise: Promise<KimiSdk | undefined>;
  private sdkLoadError: Error | undefined;
  private session: KimiSdkSession | undefined;
  private sessionId: string | undefined;
  private activeAbortController: AbortController | undefined;

  constructor(private readonly input: KimiRuntimeInput) {
    this.sdkPromise = Promise.resolve(input.sdk ?? loadKimiSdk()).catch((error) => {
      this.sdkLoadError = error instanceof Error ? error : new Error(String(error));
      return undefined;
    });
  }

  async selectSession(selection: { mode: "fresh" } | { mode: "resume"; sessionId: string }): Promise<void> {
    const sdk = await this.sdkPromise;
    if (!sdk) throw this.sdkLoadError ?? new Error("Kimi SDK is not available");

    const config = {
      workDir: this.input.workingDir,
      model: this.input.model,
      thinking: this.input.thinking ?? false,
      yoloMode: false,
      executable: findKimiCli() ?? "kimi"
    };

    if (selection.mode === "fresh") {
      this.session = sdk.createSession(config);
      this.sessionId = this.session.sessionId;
    } else {
      this.session = sdk.createSession({ ...config, sessionId: selection.sessionId });
      this.sessionId = selection.sessionId;
    }
  }

  async runTurn(input: { turnId: string; text: string; roomName?: string; speakerName: string; speakerRole: string; modeLabel: string }): Promise<KimiTurnResult> {
    if (!this.session) {
      throw new Error("kimi_session_not_selected");
    }

    const metrics: AgentRunMetrics = { files_read: 0, searches: 0, commands: 0 };
    const countedTools = new Set<string>();
    const recorder = new RunTraceRecorder({
      turnId: input.turnId,
      agentId: this.input.agentId,
      provider: "kimi-cli"
    }, {
      startNode: this.input.startNode,
      appendNodeDelta: this.input.appendNodeDelta,
      updateNode: this.input.updateNode,
      completeNode: this.input.completeNode,
      failNode: this.input.failNode
    });

    let finalText = "";
    let hasReceivedFirstEvent = false;
    let hasCompleted = false;

    let eventQueue = Promise.resolve();

    const enqueue = (fn: () => Promise<void>): void => {
      eventQueue = eventQueue.then(() => fn()).catch(() => { /* ignore */ });
    };

    const failOpenNodes = async (error: string) => {
      const openNodeIds = recorder.openNodeIds();
      if (openNodeIds.length === 0) {
        const nodeId = "kimi_error";
        await recorder.startNode({ nodeId, kind: "status", status: "running", title: "Kimi run failed" });
        await recorder.failNode({ nodeId, error });
        return;
      }
      for (const nodeId of openNodeIds) await recorder.failNode({ nodeId, error });
    };

    const closeOpenNodes = async () => {
      for (const nodeId of recorder.openNodeIds()) {
        await recorder.completeNode({ nodeId, summary: recorder.currentTitle(nodeId) ?? "Completed" });
      }
    };

    const countToolMetric = (toolCallId: string, toolName: string) => {
      if (countedTools.has(toolCallId)) return;
      const key = metricKeyForToolName(toolName);
      if (!key) return;
      countedTools.add(toolCallId);
      metrics[key] += 1;
    };

    const handleFirstEvent = async () => {
      if (!hasReceivedFirstEvent) {
        await recorder.completeNode({ nodeId: "connecting", summary: "Connected" });
        hasReceivedFirstEvent = true;
      }
    };

    await recorder.startNode({
      nodeId: "connecting",
      kind: "status",
      status: "running",
      title: "Connecting"
    });

    const abortController = new AbortController();
    this.activeAbortController = abortController;

    const prompt = promptForTurn(input);
    const turn = this.session.prompt(prompt);

    return new Promise<KimiTurnResult>((resolve, reject) => {
      const onAbort = () => {
        if (hasCompleted) return;
        hasCompleted = true;
        turn.interrupt().catch(() => { /* ignore */ });
        eventQueue.then(() => closeOpenNodes()).then(() => {
          resolve({ finalText, sessionId: this.sessionId, metrics });
        }).catch(reject);
      };

      abortController.signal.addEventListener("abort", onAbort, { once: true });

      (async () => {
        try {
          for await (const event of turn) {
            if (hasCompleted) break;
            if (abortController.signal.aborted) break;

            const kimEvent = event as KimiSdkStreamEvent;

            switch (kimEvent.type) {
              case "ContentPart": {
                enqueue(async () => {
                  await handleFirstEvent();
                  const payload = asRecord(kimEvent.payload);
                  if (payload.type === "text" && typeof payload.text === "string") {
                    finalText += payload.text;
                    await this.input.publishDelta(input.turnId, payload.text);
                  } else if (payload.type === "think" && typeof payload.think === "string") {
                    await this.input.publishDelta(input.turnId, payload.think);
                  }
                });
                break;
              }

              case "ToolCall": {
                enqueue(async () => {
                  await handleFirstEvent();
                  const payload = asRecord(kimEvent.payload);
                  const func = asRecord(payload.function);
                  const toolCallId = typeof payload.id === "string" ? payload.id : "unknown";
                  const toolName = typeof func.name === "string" ? func.name : "unknown";

                  countToolMetric(toolCallId, toolName);
                  await recorder.startNode({
                    nodeId: toolCallId,
                    kind: "tool",
                    status: "running",
                    title: toolTitle(toolName)
                  });
                });
                break;
              }

              case "ToolResult": {
                enqueue(async () => {
                  await handleFirstEvent();
                  const payload = asRecord(kimEvent.payload);
                  const toolCallId = typeof payload.tool_call_id === "string" ? payload.tool_call_id : "unknown";
                  const returnValue = asRecord(payload.return_value);
                  const output = typeof returnValue.output === "string" ? returnValue.output : "";
                  const message = typeof returnValue.message === "string" ? returnValue.message : "";
                  const text = output || message || "";

                  if (text) {
                    await recorder.appendNodeDelta({ nodeId: toolCallId, deltaType: "stdout", chunk: text });
                  }

                  await recorder.completeNode({ nodeId: toolCallId, summary: text || "Tool completed" });
                });
                break;
              }

              case "ApprovalRequest": {
                const payload = asRecord(kimEvent.payload);
                const requestId = typeof payload.id === "string" ? payload.id : "unknown";
                const action = typeof payload.action === "string" ? payload.action : "unknown action";
                const description = typeof payload.description === "string" ? payload.description : "";

                enqueue(async () => {
                  await handleFirstEvent();
                  const nodeId = `approval_${requestId}`;
                  await recorder.startNode({
                    nodeId,
                    kind: "status",
                    status: "running",
                    title: `Approval: ${action}`
                  });

                  try {
                    const decision = await this.input.requestApproval(nodeId, {
                      agent_id: this.input.agentId,
                      turn_id: input.turnId,
                      tool_node_id: nodeId,
                      tool_use_id: requestId,
                      tool_name: action,
                      description: description || `${action} requires approval`,
                      requested_at: new Date().toISOString()
                    });

                    if (decision.decision === "allow") {
                      await turn.approve(requestId, "approve");
                      await recorder.completeNode({ nodeId, summary: "Approved" });
                    } else {
                      await turn.approve(requestId, "reject");
                      await recorder.completeNode({ nodeId, summary: `Rejected: ${decision.reason ?? "no reason"}` });
                    }
                  } catch {
                    await turn.approve(requestId, "reject");
                    await recorder.failNode({ nodeId, error: "Approval request failed" });
                  }
                });
                break;
              }

              case "SubagentEvent": {
                enqueue(async () => {
                  await handleFirstEvent();
                  const payload = asRecord(kimEvent.payload);
                  const parentToolCallId = typeof payload.parent_tool_call_id === "string" ? payload.parent_tool_call_id : "unknown";
                  const nodeId = `subagent_${parentToolCallId}`;
                  await recorder.startNode({
                    nodeId,
                    kind: "status",
                    status: "running",
                    title: "Running subagent"
                  });
                  await recorder.completeNode({ nodeId, summary: "Subagent completed" });
                });
                break;
              }

              case "StatusUpdate": {
                enqueue(async () => {
                  const payload = asRecord(kimEvent.payload);
                  const tokenUsage = asRecord(payload.token_usage);
                  if (typeof tokenUsage.input_other === "number" && typeof tokenUsage.output === "number") {
                    // Token usage available but not directly mapped to run trace
                  }
                });
                break;
              }

              case "CompactionBegin": {
                enqueue(async () => {
                  await recorder.startNode({
                    nodeId: "compacting",
                    kind: "status",
                    status: "running",
                    title: "Compacting context"
                  });
                });
                break;
              }

              case "CompactionEnd": {
                enqueue(async () => {
                  await recorder.completeNode({ nodeId: "compacting", summary: "Context compacted" });
                });
                break;
              }
            }
          }

          // Wait for all queued events to complete
          await eventQueue;

          if (!hasCompleted) {
            hasCompleted = true;
            await closeOpenNodes();
            resolve({ finalText, sessionId: this.sessionId, metrics });
          }
        } catch (error) {
          if (!hasCompleted) {
            hasCompleted = true;
            const message = error instanceof Error ? error.message : String(error);
            await failOpenNodes(message);
            reject(new Error(message));
          }
        }
      })();
    }).finally(() => {
      if (this.activeAbortController === abortController) {
        this.activeAbortController = undefined;
      }
    });
  }

  async close(): Promise<void> {
    this.activeAbortController?.abort();
    if (this.session) {
      try {
        await this.session.close();
      } catch {
        // ignore close errors
      }
    }
  }
}
