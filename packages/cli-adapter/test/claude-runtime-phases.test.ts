import { describe, expect, it } from "vitest";
import { ClaudeRuntime } from "../src/claude/runtime.js";

describe("Claude runtime SDK message phase mapping", () => {
  async function createRuntimeWithStream(messages: unknown[]) {
    const sdk = {
      createSession: async () => ({
        sessionId: "session_1",
        send: async () => undefined,
        stream: async function* () {
          for (const msg of messages) yield msg;
        },
        close: async () => undefined
      }),
      resumeSession: async () => { throw new Error("unexpected"); }
    };
    const statuses: Array<{ phase: string; current: string; detail?: Record<string, unknown> }> = [];
    const deltas: string[] = [];
    const thinkingDeltas: Array<{ text: string; done: boolean }> = [];
    const runtime = new ClaudeRuntime({
      sdk,
      agentId: "agent_1",
      workingDir: "D:\\Development\\2",
      permissionMode: "read_only",
      model: "claude-sonnet-4-20250514",
      publishStatus: async (_turnId, status) => {
        statuses.push({ phase: status.phase, current: status.current, detail: status.detail as Record<string, unknown> | undefined });
      },
      publishDelta: async (_turnId, chunk) => { deltas.push(chunk); },
      publishThinkingDelta: async (_turnId, text, done) => { thinkingDeltas.push({ text, done }); }
    });
    await runtime.selectSession({ mode: "fresh" });
    return { runtime, statuses, deltas, thinkingDeltas };
  }

  it("maps SDKStatusMessage requesting to requesting_api phase", async () => {
    const { runtime, statuses } = await createRuntimeWithStream([
      { type: "system", subtype: "status", status: "requesting", uuid: "u1", session_id: "session_1" },
      { type: "assistant", message: { content: [{ type: "text", text: "ok" }] }, uuid: "u2", session_id: "session_1" },
      { type: "system", subtype: "session_state_changed", state: "idle", uuid: "u3", session_id: "session_1" }
    ]);
    await runtime.runTurn({ turnId: "turn_1", roomName: "Room", speakerName: "Owner", speakerRole: "owner", modeLabel: "normal", text: "hello" });
    expect(statuses.some((s) => s.phase === "requesting_api")).toBe(true);
  });

  it("maps SDKAPIRetryMessage to retrying_api phase with retry detail", async () => {
    const { runtime, statuses } = await createRuntimeWithStream([
      { type: "system", subtype: "api_retry", attempt: 2, max_retries: 3, retry_delay_ms: 2000, error_status: 529, error: "rate_limit", uuid: "u1", session_id: "session_1" },
      { type: "assistant", message: { content: [{ type: "text", text: "ok" }] }, uuid: "u2", session_id: "session_1" },
      { type: "system", subtype: "session_state_changed", state: "idle", uuid: "u3", session_id: "session_1" }
    ]);
    await runtime.runTurn({ turnId: "turn_1", roomName: "Room", speakerName: "Owner", speakerRole: "owner", modeLabel: "normal", text: "hello" });
    const retryStatus = statuses.find((s) => s.phase === "retrying_api");
    expect(retryStatus).toBeDefined();
    expect(retryStatus!.detail).toMatchObject({ attempt: 2, max_retries: 3, retry_delay_ms: 2000 });
  });

  it("maps SDKToolProgressMessage to tool phase with elapsed_time_seconds detail", async () => {
    const { runtime, statuses } = await createRuntimeWithStream([
      { type: "tool_progress", tool_use_id: "tu1", tool_name: "Read", parent_tool_use_id: null, elapsed_time_seconds: 3, uuid: "u1", session_id: "session_1" },
      { type: "assistant", message: { content: [{ type: "text", text: "done" }] }, uuid: "u2", session_id: "session_1" },
      { type: "system", subtype: "session_state_changed", state: "idle", uuid: "u3", session_id: "session_1" }
    ]);
    await runtime.runTurn({ turnId: "turn_1", roomName: "Room", speakerName: "Owner", speakerRole: "owner", modeLabel: "normal", text: "hello" });
    const toolStatus = statuses.find((s) => s.phase === "reading_files");
    expect(toolStatus).toBeDefined();
    expect(toolStatus!.detail).toMatchObject({ elapsed_time_seconds: 3 });
  });

  it("extracts thinking_delta from stream_event content_block_start/delta/stop", async () => {
    const { runtime, thinkingDeltas } = await createRuntimeWithStream([
      { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "sig1" } }, uuid: "u1", session_id: "session_1" },
      { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Let me analyze" } }, uuid: "u2", session_id: "session_1" },
      { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: " the structure" } }, uuid: "u3", session_id: "session_1" },
      { type: "stream_event", event: { type: "content_block_stop", index: 0 }, uuid: "u4", session_id: "session_1" },
      { type: "assistant", message: { content: [{ type: "text", text: "Here is the analysis" }] }, uuid: "u5", session_id: "session_1" },
      { type: "system", subtype: "session_state_changed", state: "idle", uuid: "u6", session_id: "session_1" }
    ]);
    await runtime.runTurn({ turnId: "turn_1", roomName: "Room", speakerName: "Owner", speakerRole: "owner", modeLabel: "normal", text: "analyze" });

    expect(thinkingDeltas).toHaveLength(4);
    expect(thinkingDeltas[0]).toEqual({ text: "", done: false });
    expect(thinkingDeltas[1]).toEqual({ text: "Let me analyze", done: false });
    expect(thinkingDeltas[2]).toEqual({ text: " the structure", done: false });
    expect(thinkingDeltas[3]).toEqual({ text: "", done: true });
  });

  it("maps SDKMemoryRecallMessage to recalling_memory phase", async () => {
    const { runtime, statuses } = await createRuntimeWithStream([
      { type: "system", subtype: "memory_recall", mode: "select", memories: [{ path: "/mem.md", scope: "personal" }], uuid: "u1", session_id: "session_1" },
      { type: "assistant", message: { content: [{ type: "text", text: "ok" }] }, uuid: "u2", session_id: "session_1" },
      { type: "system", subtype: "session_state_changed", state: "idle", uuid: "u3", session_id: "session_1" }
    ]);
    await runtime.runTurn({ turnId: "turn_1", roomName: "Room", speakerName: "Owner", speakerRole: "owner", modeLabel: "normal", text: "hello" });
    const status = statuses.find((s) => s.phase === "recalling_memory");
    expect(status).toBeDefined();
    expect(status!.detail).toMatchObject({ mode: "select", memory_count: 1 });
  });

  it("maps SDKCompactBoundaryMessage to compacting_context phase", async () => {
    const { runtime, statuses } = await createRuntimeWithStream([
      { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 15000, post_tokens: 8000, duration_ms: 1200 }, uuid: "u1", session_id: "session_1" },
      { type: "assistant", message: { content: [{ type: "text", text: "ok" }] }, uuid: "u2", session_id: "session_1" },
      { type: "system", subtype: "session_state_changed", state: "idle", uuid: "u3", session_id: "session_1" }
    ]);
    await runtime.runTurn({ turnId: "turn_1", roomName: "Room", speakerName: "Owner", speakerRole: "owner", modeLabel: "normal", text: "hello" });
    const status = statuses.find((s) => s.phase === "compacting_context");
    expect(status).toBeDefined();
    expect(status!.detail).toMatchObject({ pre_tokens: 15000, post_tokens: 8000 });
  });

  it("maps SDKResultMessage to completed phase with cost and usage detail", async () => {
    const { runtime, statuses } = await createRuntimeWithStream([
      { type: "result", subtype: "success", duration_ms: 5000, duration_api_ms: 3200, is_error: false, num_turns: 3, result: "final answer", stop_reason: "end_turn", total_cost_usd: 0.0042, usage: { input_tokens: 1200, output_tokens: 800 }, modelUsage: {}, permission_denials: [], uuid: "u1", session_id: "session_1" }
    ]);
    await runtime.runTurn({ turnId: "turn_1", roomName: "Room", speakerName: "Owner", speakerRole: "owner", modeLabel: "normal", text: "hello" });
    const completed = statuses.find((s) => s.phase === "completed");
    expect(completed).toBeDefined();
    expect(completed!.detail).toMatchObject({ duration_ms: 5000, total_cost_usd: 0.0042, num_turns: 3, usage: { input_tokens: 1200, output_tokens: 800 } });
  });
});
