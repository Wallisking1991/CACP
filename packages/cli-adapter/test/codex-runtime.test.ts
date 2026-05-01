import { describe, expect, it } from "vitest";
import { CodexRuntime } from "../src/codex/runtime.js";
import type { CodexThreadEvent } from "../src/codex/types.js";

async function* events(items: CodexThreadEvent[]) {
  for (const item of items) yield item;
}

describe("Codex runtime", () => {
  it("requires explicit session selection before running a turn", async () => {
    const runtime = new CodexRuntime({
      sdk: {
        startThread: () => { throw new Error("unexpected"); },
        resumeThread: () => { throw new Error("unexpected"); }
      },
      agentId: "agent_1",
      workingDir: "D:\\Development\\2",
      permissionLevel: "read_only",
      publishStatus: async () => undefined,
      publishDelta: async () => undefined
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

  it("maps command execution events and final text", async () => {
    const deltas: string[] = [];
    const statuses: Array<{ phase: string; current: string }> = [];
    const runtime = new CodexRuntime({
      sdk: {
        startThread: (options) => ({
          id: null,
          runStreamed: async (prompt: string) => {
            expect(prompt).toContain("Message: list files");
            expect(options.sandboxMode).toBe("read-only");
            return {
              events: events([
                { type: "thread.started", thread_id: "thread_123" },
                { type: "turn.started" },
                { type: "item.started", item: { id: "cmd_1", type: "command_execution", command: "Get-ChildItem", aggregated_output: "", status: "in_progress" } },
                { type: "item.completed", item: { id: "cmd_1", type: "command_execution", command: "Get-ChildItem", aggregated_output: "file.txt", exit_code: 0, status: "completed" } },
                { type: "item.completed", item: { id: "msg_1", type: "agent_message", text: "Done." } },
                { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } }
              ])
            };
          }
        }),
        resumeThread: () => { throw new Error("unexpected"); }
      },
      agentId: "agent_1",
      workingDir: "D:\\Development\\2",
      permissionLevel: "read_only",
      publishStatus: async (_turnId, status) => { statuses.push({ phase: status.phase, current: status.current }); },
      publishDelta: async (_turnId, chunk) => { deltas.push(chunk); }
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

    expect(result.finalText).toBe("Done.");
    expect(result.sessionId).toBe("thread_123");
    expect(result.metrics.commands).toBe(1);
    expect(deltas).toEqual(["Done."]);
    expect(statuses.some((status) => status.phase === "running_command" && status.current.includes("Get-ChildItem"))).toBe(true);
  });

  it("streams agent message updates and reports command completion", async () => {
    const deltas: string[] = [];
    const statuses: Array<{ phase: string; current: string }> = [];
    const runtime = new CodexRuntime({
      sdk: {
        startThread: () => ({
          id: null,
          runStreamed: async () => ({
            events: events([
              { type: "thread.started", thread_id: "thread_123" },
              { type: "turn.started" },
              { type: "item.started", item: { id: "cmd_1", type: "command_execution", command: "Get-ChildItem", aggregated_output: "", status: "in_progress" } },
              { type: "item.completed", item: { id: "cmd_1", type: "command_execution", command: "Get-ChildItem", aggregated_output: "file.txt", exit_code: 0, status: "completed" } },
              { type: "item.updated", item: { id: "msg_1", type: "agent_message", text: "Hel" } },
              { type: "item.updated", item: { id: "msg_1", type: "agent_message", text: "Hello" } },
              { type: "item.completed", item: { id: "msg_1", type: "agent_message", text: "Hello" } },
              { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } }
            ])
          })
        }),
        resumeThread: () => { throw new Error("unexpected"); }
      },
      agentId: "agent_1",
      workingDir: "D:\\Development\\2",
      permissionLevel: "read_only",
      publishStatus: async (_turnId, status) => { statuses.push({ phase: status.phase, current: status.current }); },
      publishDelta: async (_turnId, chunk) => { deltas.push(chunk); }
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
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(statuses.some((status) => status.phase === "running_command" && status.current === "Command completed with exit code 0")).toBe(true);
  });

  it("fails the turn when the Codex stream ends before turn.completed", async () => {
    const statuses: Array<{ phase: string; current: string }> = [];
    const runtime = new CodexRuntime({
      sdk: {
        startThread: () => ({
          id: null,
          runStreamed: async () => ({
            events: events([
              { type: "thread.started", thread_id: "thread_123" },
              { type: "turn.started" },
              { type: "item.completed", item: { id: "msg_1", type: "agent_message", text: "Partial answer" } }
            ])
          })
        }),
        resumeThread: () => { throw new Error("unexpected"); }
      },
      agentId: "agent_1",
      workingDir: "D:\\Development\\2",
      permissionLevel: "read_only",
      publishStatus: async (_turnId, status) => { statuses.push({ phase: status.phase, current: status.current }); },
      publishDelta: async () => undefined
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
    expect(statuses.at(-1)).toEqual({ phase: "failed", current: "codex_turn_incomplete" });
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

    const runtime = new CodexRuntime({
      sdk: {
        startThread: () => ({
          id: null,
          runStreamed: async (_prompt: string, options?: { signal?: AbortSignal }) => {
            turnSignal = options?.signal;
            return { events: abortableEvents() };
          }
        }),
        resumeThread: () => { throw new Error("unexpected"); }
      },
      agentId: "agent_1",
      workingDir: "D:\\Development\\2",
      permissionLevel: "read_only",
      publishStatus: async () => undefined,
      publishDelta: async () => undefined
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
