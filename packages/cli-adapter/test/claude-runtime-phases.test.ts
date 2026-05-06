import { describe, expect, it, vi } from "vitest";
import { ClaudeRuntime } from "../src/claude/runtime.js";

function createQuery(messages: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) yield message;
    },
    close: vi.fn()
  };
}

function createSuccessResult(sessionId = "session_1", result = "Done") {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 1000,
    duration_api_ms: 800,
    is_error: false,
    num_turns: 1,
    result,
    stop_reason: "end_turn",
    total_cost_usd: 0.001,
    usage: { input_tokens: 10, output_tokens: 20 },
    modelUsage: {},
    permission_denials: [],
    uuid: "result_1",
    session_id: sessionId
  };
}

function createHarness(queryImpl: (prompt: string, options: Record<string, unknown>) => ReturnType<typeof createQuery>) {
  const publishedDeltas: string[] = [];
  const started: Array<Record<string, unknown>> = [];
  const nodeDeltas: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const completed: Array<Record<string, unknown>> = [];
  const failed: Array<Record<string, unknown>> = [];
  const approvals: Array<{ nodeId: string; payload: Record<string, unknown> }> = [];
  const elicitations: Array<{ nodeId: string; payload: Record<string, unknown> }> = [];

  const runtime = new ClaudeRuntime({
    sdk: {
      query: ({ prompt, options }: { prompt: string; options: Record<string, unknown> }) => queryImpl(prompt, options)
    },
    agentId: "agent_1",
    workingDir: "D:\\Development\\2",
    permissionLevel: "limited_write",
    model: "claude-sonnet-4-20250514",
    publishDelta: async (_turnId: string, chunk: string) => { publishedDeltas.push(chunk); },
    startNode: async (payload: Record<string, unknown>) => { started.push(payload); },
    appendNodeDelta: async (payload: Record<string, unknown>) => { nodeDeltas.push(payload); },
    updateNode: async (payload: Record<string, unknown>) => { updated.push(payload); },
    completeNode: async (payload: Record<string, unknown>) => { completed.push(payload); },
    failNode: async (payload: Record<string, unknown>) => { failed.push(payload); },
    requestApproval: async (nodeId: string, payload: Record<string, unknown>) => {
      approvals.push({ nodeId, payload });
      return { decision: "allow", resolved_by: "user_1", resolved_at: "2026-05-05T00:00:00.000Z" };
    },
    requestElicitation: async (nodeId: string, payload: Record<string, unknown>) => {
      elicitations.push({ nodeId, payload });
      return { action: "accept", content: { token: "abc" }, resolved_by: "user_1", resolved_at: "2026-05-05T00:00:00.000Z" };
    }
  });

  return { runtime, publishedDeltas, started, nodeDeltas, updated, completed, failed, approvals, elicitations };
}

describe("Claude runtime run-trace mapping", () => {
  it("maps tool use and progress into tool nodes without persisting raw thinking deltas", async () => {
    const { runtime, started, nodeDeltas, updated, completed, publishedDeltas } = createHarness(() => createQuery([
      { type: "system", subtype: "init", session_id: "session_1", uuid: "init_1" },
      { type: "stream_event", parent_tool_use_id: null, uuid: "partial_1", session_id: "session_1", event: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "sig" } } },
      { type: "stream_event", parent_tool_use_id: null, uuid: "partial_2", session_id: "session_1", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "secret reasoning" } } },
      { type: "stream_event", parent_tool_use_id: null, uuid: "partial_3", session_id: "session_1", event: { type: "content_block_stop", index: 0 } },
      { type: "stream_event", parent_tool_use_id: null, uuid: "partial_4", session_id: "session_1", event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "README.md" } } } },
      { type: "tool_progress", tool_use_id: "toolu_1", tool_name: "Read", parent_tool_use_id: null, elapsed_time_seconds: 3, uuid: "tool_progress_1", session_id: "session_1" },
      { type: "tool_use_summary", summary: "Read README.md", preceding_tool_use_ids: ["toolu_1"], uuid: "tool_summary_1", session_id: "session_1" },
      { type: "assistant", parent_tool_use_id: null, uuid: "assistant_1", session_id: "session_1", message: { content: [{ type: "text", text: "Done" }] } },
      createSuccessResult("session_1", "Done")
    ]));

    await runtime.selectSession({ mode: "fresh" });
    const result = await runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "inspect"
    });

    expect(started.some((node) => node.node_id === "toolu_1" && node.kind === "tool" && String(node.title).includes("README.md"))).toBe(true);
    expect(updated.some((node) => node.node_id === "toolu_1" && (node.detail as Record<string, unknown> | undefined)?.elapsed_time_seconds === 3)).toBe(true);
    expect(completed.some((node) => node.node_id === "toolu_1" && node.summary === "Read README.md")).toBe(true);
    expect(started.some((node) => node.kind === "status" && node.title === "Thinking")).toBe(true);
    const thinkingNode = started.find((node) => node.kind === "status" && node.title === "Thinking");
    expect(completed.some((node) => node.node_id === thinkingNode?.node_id && node.summary === "Thinking complete")).toBe(true);
    expect(started.some((node) => JSON.stringify(node).includes("secret reasoning"))).toBe(false);
    expect(completed.some((node) => JSON.stringify(node).includes("secret reasoning"))).toBe(false);
    expect(nodeDeltas.some((delta) => typeof delta.chunk === "string" && delta.chunk.includes("secret reasoning"))).toBe(false);
    expect(publishedDeltas).toEqual(["Done"]);
    expect(result.metrics.files_read).toBe(1);
  });

  it("routes Bash permission prompts through room-backed approval requests", async () => {
    const { runtime, approvals, started } = createHarness((_prompt, options) => {
      const canUseTool = options.canUseTool as undefined | ((toolName: string, input: Record<string, unknown>, toolOptions: Record<string, unknown>) => Promise<unknown>);
      if (!canUseTool) throw new Error("missing canUseTool");
      void canUseTool("Bash", { command: "pnpm install" }, {
        signal: new AbortController().signal,
        toolUseID: "toolu_bash",
        title: "Claude wants to run Bash",
        displayName: "Run Bash",
        description: "Install dependencies",
        decisionReason: "Command execution needs approval"
      });
      return createQuery([
        { type: "system", subtype: "init", session_id: "session_1", uuid: "init_1" },
        createSuccessResult("session_1", "Done")
      ]);
    });

    await runtime.selectSession({ mode: "fresh" });
    await runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "install deps"
    });

    expect(started.some((node) => node.node_id === "toolu_bash" && node.kind === "tool")).toBe(true);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      nodeId: "approval_toolu_bash",
      payload: {
        tool_node_id: "toolu_bash",
        tool_use_id: "toolu_bash",
        tool_name: "Bash",
        title: "Claude wants to run Bash",
        display_name: "Run Bash",
        description: "Install dependencies",
        decision_reason: "Command execution needs approval"
      }
    });
  });

  it("routes MCP elicitations through room-backed interaction requests", async () => {
    const { runtime, elicitations } = createHarness((_prompt, options) => {
      const onElicitation = options.onElicitation as undefined | ((request: Record<string, unknown>, elicitationOptions: Record<string, unknown>) => Promise<unknown>);
      if (!onElicitation) throw new Error("missing onElicitation");
      void onElicitation({
        serverName: "github",
        message: "Approve auth",
        mode: "url",
        url: "https://example.com/auth",
        elicitationId: "elicit_1",
        title: "Authentication required",
        displayName: "GitHub",
        description: "Open the auth page"
      }, { signal: new AbortController().signal });
      return createQuery([
        { type: "system", subtype: "init", session_id: "session_1", uuid: "init_1" },
        createSuccessResult("session_1", "Done")
      ]);
    });

    await runtime.selectSession({ mode: "fresh" });
    await runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "authenticate"
    });

    expect(elicitations).toHaveLength(1);
    expect(elicitations[0]).toMatchObject({
      nodeId: "elicit_1",
      payload: {
        title: "Authentication required",
        display_name: "GitHub",
        description: "Open the auth page",
        message: "Approve auth",
        mode: "url",
        url: "https://example.com/auth"
      }
    });
  });

  it("maps memory recall, subagent forwarding, hook events, retries, and compaction into structured nodes", async () => {
    const { runtime, started, completed } = createHarness(() => createQuery([
      { type: "system", subtype: "init", session_id: "session_1", uuid: "init_1" },
      { type: "system", subtype: "memory_recall", mode: "select", memories: [{ path: "D:/mem.md", scope: "personal" }], uuid: "memory_1", session_id: "session_1" },
      { type: "system", subtype: "task_started", task_id: "task_1", tool_use_id: "toolu_task", description: "Run subagent", uuid: "task_started_1", session_id: "session_1" },
      { type: "assistant", parent_tool_use_id: "toolu_task", uuid: "assistant_task_1", session_id: "session_1", message: { content: [{ type: "text", text: "Subagent reply" }] } },
      { type: "system", subtype: "task_notification", task_id: "task_1", tool_use_id: "toolu_task", status: "completed", output_file: "out.txt", summary: "Subagent complete", uuid: "task_notification_1", session_id: "session_1" },
      { type: "system", subtype: "hook_started", hook_id: "hook_1", hook_name: "pre-commit", hook_event: "PreToolUse", uuid: "hook_started_1", session_id: "session_1" },
      { type: "system", subtype: "hook_progress", hook_id: "hook_1", hook_name: "pre-commit", hook_event: "PreToolUse", stdout: "lint", stderr: "", output: "lint", uuid: "hook_progress_1", session_id: "session_1" },
      { type: "system", subtype: "hook_response", hook_id: "hook_1", hook_name: "pre-commit", hook_event: "PreToolUse", stdout: "ok", stderr: "", output: "ok", outcome: "success", uuid: "hook_response_1", session_id: "session_1" },
      { type: "system", subtype: "api_retry", attempt: 2, max_retries: 3, retry_delay_ms: 1500, error_status: 529, uuid: "retry_1", session_id: "session_1" },
      { type: "system", subtype: "status", status: "compacting", uuid: "status_1", session_id: "session_1" },
      { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 15000, post_tokens: 8000, duration_ms: 1200 }, uuid: "compact_1", session_id: "session_1" },
      createSuccessResult("session_1", "Done")
    ]));

    await runtime.selectSession({ mode: "fresh" });
    await runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "run"
    });

    expect(started.some((node) => node.kind === "memory")).toBe(true);
    expect(started.some((node) => node.node_id === "task_1" && node.kind === "subagent")).toBe(true);
    expect(started.some((node) => node.kind === "subagent_message" && node.parent_node_id === "task_1" && node.text === "Subagent reply")).toBe(true);
    expect(started.some((node) => node.node_id === "hook_1" && node.kind === "hook")).toBe(true);
    expect(started.some((node) => node.kind === "api_retry")).toBe(true);
    expect(started.some((node) => node.kind === "compaction")).toBe(true);
    expect(completed.some((node) => node.node_id === "task_1" && node.summary === "Subagent complete")).toBe(true);
    expect(completed.some((node) => node.node_id === "hook_1")).toBe(true);
  });
});
