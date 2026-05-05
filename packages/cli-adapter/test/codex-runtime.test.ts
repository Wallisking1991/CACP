import { describe, expect, it } from "vitest";
import { CodexRuntime } from "../src/codex/runtime.js";
import type { CodexThreadEvent } from "../src/codex/types.js";

async function* events(items: CodexThreadEvent[]) {
  for (const item of items) yield item;
}

function createRuntime(overrides: Record<string, unknown> = {}) {
  const publishedDeltas: string[] = [];
  const started: Array<Record<string, unknown>> = [];
  const nodeDeltas: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const completed: Array<Record<string, unknown>> = [];
  const failed: Array<Record<string, unknown>> = [];

  const runtime = new CodexRuntime({
    agentId: "agent_1",
    workingDir: "D:\\Development\\2",
    permissionLevel: "read_only",
    publishDelta: async (_turnId: string, chunk: string) => { publishedDeltas.push(chunk); },
    startNode: async (payload: Record<string, unknown>) => { started.push(payload); },
    appendNodeDelta: async (payload: Record<string, unknown>) => { nodeDeltas.push(payload); },
    updateNode: async (payload: Record<string, unknown>) => { updated.push(payload); },
    completeNode: async (payload: Record<string, unknown>) => { completed.push(payload); },
    failNode: async (payload: Record<string, unknown>) => { failed.push(payload); },
    ...overrides
  });

  return { runtime, publishedDeltas, started, nodeDeltas, updated, completed, failed };
}

describe("Codex runtime", () => {
  it("requires explicit session selection before running a turn", async () => {
    const { runtime } = createRuntime({
      sdk: {
        startThread: () => { throw new Error("unexpected"); },
        resumeThread: () => { throw new Error("unexpected"); }
      }
    });

    await expect(runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "hello"
    })).rejects.toThrow("codex_session_not_selected");
  });

  it("absorbs sdk load failure so the process does not crash from an unhandled rejection", async () => {
    const { runtime } = createRuntime({
      sdk: Promise.reject(new Error("Codex SDK not installed")) as unknown as {
        startThread: () => never;
        resumeThread: () => never;
      }
    });

    await expect(runtime.selectSession({ mode: "fresh" })).rejects.toThrow("Codex SDK not installed");
  });

  it("maps command execution, web search, and agent message updates into run-trace nodes", async () => {
    const { runtime, publishedDeltas, started, nodeDeltas, completed } = createRuntime({
      sdk: {
        startThread: (options: Record<string, unknown>) => ({
          id: null,
          runStreamed: async (prompt: string) => {
            expect(prompt).toContain("Message: list files");
            expect(options.sandboxMode).toBe("read-only");
            return {
              events: events([
                { type: "thread.started", thread_id: "thread_123" },
                { type: "turn.started" },
                { type: "item.started", item: { id: "reason_1", type: "reasoning" } },
                { type: "item.started", item: { id: "cmd_1", type: "command_execution", command: "Get-ChildItem", aggregated_output: "", status: "in_progress" } },
                { type: "item.completed", item: { id: "cmd_1", type: "command_execution", command: "Get-ChildItem", aggregated_output: "file.txt", exit_code: 0, status: "completed" } },
                { type: "item.started", item: { id: "search_1", type: "web_search", status: "in_progress" } },
                { type: "item.completed", item: { id: "search_1", type: "web_search", status: "completed" } },
                { type: "item.updated", item: { id: "msg_1", type: "agent_message", text: "Hel" } },
                { type: "item.updated", item: { id: "msg_1", type: "agent_message", text: "Hello" } },
                { type: "item.completed", item: { id: "msg_1", type: "agent_message", text: "Hello" } },
                { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } }
              ])
            };
          }
        }),
        resumeThread: () => { throw new Error("unexpected"); }
      }
    });

    await runtime.selectSession({ mode: "fresh" });
    const result = await runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "list files"
    });

    expect(result.finalText).toBe("Hello");
    expect(result.sessionId).toBe("thread_123");
    expect(result.metrics.commands).toBe(1);
    expect(result.metrics.searches).toBe(1);
    expect(started.some((node) => node.node_id === "cmd_1" && node.kind === "tool" && String(node.title).includes("Get-ChildItem"))).toBe(true);
    expect(started.some((node) => node.node_id === "search_1" && node.kind === "tool")).toBe(true);
    expect(nodeDeltas.some((delta) => delta.node_id === "cmd_1" && delta.chunk === "file.txt")).toBe(true);
    expect(completed.some((node) => node.node_id === "cmd_1" && (node.detail as Record<string, unknown> | undefined)?.exit_code === 0)).toBe(true);
    expect(publishedDeltas).toEqual(["Hel", "lo"]);
  });

  it("fails the turn when the Codex stream ends before turn.completed", async () => {
    const { runtime, failed } = createRuntime({
      sdk: {
        startThread: () => ({
          id: null,
          runStreamed: async () => ({
            events: events([
              { type: "thread.started", thread_id: "thread_123" },
              { type: "turn.started" },
              { type: "item.started", item: { id: "cmd_1", type: "command_execution", command: "Get-ChildItem", aggregated_output: "", status: "in_progress" } },
              { type: "item.completed", item: { id: "msg_1", type: "agent_message", text: "Partial answer" } }
            ])
          })
        }),
        resumeThread: () => { throw new Error("unexpected"); }
      }
    });

    await runtime.selectSession({ mode: "fresh" });

    await expect(runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "list files"
    })).rejects.toThrow("codex_turn_incomplete");
    expect(failed.some((node) => node.error === "codex_turn_incomplete")).toBe(true);
  });

  it("aborts the active Codex turn when the runtime closes", async () => {
    let turnSignal: AbortSignal | undefined;
    async function* abortableEvents() {
      yield { type: "turn.started" } satisfies CodexThreadEvent;
      await new Promise<void>((resolve) => {
        turnSignal?.addEventListener("abort", () => resolve(), { once: true });
        setTimeout(resolve, 200);
      });
    }

    const { runtime } = createRuntime({
      sdk: {
        startThread: () => ({
          id: null,
          runStreamed: async (_prompt: string, options?: { signal?: AbortSignal }) => {
            turnSignal = options?.signal;
            return { events: abortableEvents() };
          }
        }),
        resumeThread: () => { throw new Error("unexpected"); }
      }
    });

    await runtime.selectSession({ mode: "fresh" });
    const running = runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "keep running"
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(turnSignal).toBeDefined();
    await runtime.close();
    expect(turnSignal?.aborted).toBe(true);
    await running;
  });
});
