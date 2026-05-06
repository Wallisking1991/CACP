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

function createHarness(
  queryImpl: (prompt: string, options: Record<string, unknown>) => ReturnType<typeof createQuery>,
  overrides: { permissionLevel?: string } = {}
) {
  let activeQueryImpl = queryImpl;
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
      query: ({ prompt, options }: { prompt: string; options: Record<string, unknown> }) => activeQueryImpl(prompt, options)
    },
    agentId: "agent_1",
    workingDir: "D:\\Development\\2",
    permissionLevel: overrides.permissionLevel ?? "limited_write",
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

  const setQueryImpl = (next: typeof queryImpl) => {
    activeQueryImpl = next;
  };

  return { runtime, setQueryImpl, publishedDeltas, started, nodeDeltas, updated, completed, failed, approvals, elicitations };
}

describe("Claude runtime run-trace mapping", () => {
  it("streams SDK thinking deltas into a reasoning node and enriches streamed tool input", async () => {
    let capturedOptions: Record<string, unknown> | undefined;
    const { runtime, started, nodeDeltas, updated, completed, publishedDeltas } = createHarness((_prompt, options) => {
      capturedOptions = options;
      return createQuery([
        { type: "system", subtype: "init", session_id: "session_1", uuid: "init_1" },
        { type: "stream_event", parent_tool_use_id: null, uuid: "partial_1", session_id: "session_1", event: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "sig" } } },
        { type: "stream_event", parent_tool_use_id: null, uuid: "partial_2", session_id: "session_1", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "I should inspect the directory first. " } } },
        { type: "stream_event", parent_tool_use_id: null, uuid: "partial_3", session_id: "session_1", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "A glob search is enough." } } },
        { type: "stream_event", parent_tool_use_id: null, uuid: "partial_4", session_id: "session_1", event: { type: "content_block_stop", index: 0 } },
        { type: "stream_event", parent_tool_use_id: null, uuid: "partial_5", session_id: "session_1", event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_glob", name: "Glob", input: {} } } },
        { type: "stream_event", parent_tool_use_id: null, uuid: "partial_6", session_id: "session_1", event: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"pattern\":" } } },
        { type: "stream_event", parent_tool_use_id: null, uuid: "partial_7", session_id: "session_1", event: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "\"src/**/*.ts\"" } } },
        { type: "stream_event", parent_tool_use_id: null, uuid: "partial_8", session_id: "session_1", event: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "}" } } },
        { type: "stream_event", parent_tool_use_id: null, uuid: "partial_9", session_id: "session_1", event: { type: "content_block_stop", index: 1 } },
        { type: "tool_progress", tool_use_id: "toolu_glob", tool_name: "Glob", parent_tool_use_id: null, elapsed_time_seconds: 3, uuid: "tool_progress_1", session_id: "session_1" },
        { type: "tool_use_summary", summary: "Found TypeScript files", preceding_tool_use_ids: ["toolu_glob"], uuid: "tool_summary_1", session_id: "session_1" },
        { type: "stream_event", parent_tool_use_id: null, uuid: "partial_10", session_id: "session_1", event: { type: "content_block_start", index: 2, content_block: { type: "text", text: "" } } },
        { type: "stream_event", parent_tool_use_id: null, uuid: "partial_11", session_id: "session_1", event: { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Done" } } },
        { type: "stream_event", parent_tool_use_id: null, uuid: "partial_12", session_id: "session_1", event: { type: "content_block_stop", index: 2 } },
        createSuccessResult("session_1", "Done")
      ]);
    });

    await runtime.selectSession({ mode: "fresh" });
    const result = await runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "inspect"
    });

    expect(capturedOptions).not.toHaveProperty("thinking");
    const reasoningNode = started.find((node) => node.kind === "reasoning_summary" && node.title === "Thinking");
    expect(reasoningNode).toBeDefined();
    const reasoningNodeId = reasoningNode?.node_id;
    expect(nodeDeltas.filter((delta) => delta.node_id === reasoningNodeId).map((delta) => delta.chunk).join("")).toBe("I should inspect the directory first. A glob search is enough.");
    const completedReasoningNode = completed.find((node) => node.node_id === reasoningNodeId);
    expect(completedReasoningNode).toBeDefined();
    expect(completedReasoningNode).not.toHaveProperty("summary");
    expect(started.some((node) => node.node_id === "toolu_glob" && node.kind === "tool" && node.title === "Glob")).toBe(true);
    expect(updated.some((node) => node.node_id === "toolu_glob" && node.title === "Search files: src/**/*.ts")).toBe(true);
    expect(updated.some((node) => node.node_id === "toolu_glob" && (node.detail as Record<string, unknown> | undefined)?.tool_name === "Glob")).toBe(true);
    expect(updated.some((node) => node.node_id === "toolu_glob" && JSON.stringify(node.detail).includes("src/**/*.ts"))).toBe(true);
    const latestGlobUpdate = updated.filter((node) => node.node_id === "toolu_glob").at(-1);
    expect(latestGlobUpdate?.detail).toMatchObject({
      tool_name: "Glob",
      input: { pattern: "src/**/*.ts" },
      elapsed_time_seconds: 3
    });
    expect(completed.some((node) => node.node_id === "toolu_glob" && node.summary === "Found TypeScript files")).toBe(true);
    expect(publishedDeltas).toEqual(["Done"]);
    expect(result.metrics.searches).toBe(1);
  });

  it("preserves SDK result timing, cost, turns, and usage metadata", async () => {
    const { runtime } = createHarness(() => createQuery([
      {
        type: "result",
        subtype: "success",
        duration_ms: 2345,
        duration_api_ms: 2000,
        is_error: false,
        num_turns: 2,
        result: "Done",
        stop_reason: "end_turn",
        total_cost_usd: 0.0123,
        usage: { input_tokens: 100, cache_read_input_tokens: 400, output_tokens: 50 },
        modelUsage: { "claude-sonnet-4-20250514": { inputTokens: 100, outputTokens: 50 } },
        permission_denials: [{ tool_name: "Bash", tool_use_id: "toolu_bash", tool_input: { command: "rm -rf dist" } }],
        terminal_reason: "completed",
        uuid: "result_1",
        session_id: "session_1"
      }
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

    expect(result.usage).toMatchObject({
      input_tokens: 100,
      cache_read_input_tokens: 400,
      output_tokens: 50,
      duration_ms: 2345,
      duration_api_ms: 2000,
      num_turns: 2,
      total_cost_usd: 0.0123,
      terminal_reason: "completed"
    });
    expect(result.usage?.model_usage).toEqual({ "claude-sonnet-4-20250514": { inputTokens: 100, outputTokens: 50 } });
    expect(result.usage?.permission_denials).toEqual([{ tool_name: "Bash", tool_use_id: "toolu_bash", tool_input: { command: "rm -rf dist" } }]);
  });

  it("streams long SDK-provided node summaries as full deltas while keeping terminal summaries short", async () => {
    const longSummary = "x".repeat(9000);
    const { runtime, nodeDeltas, completed } = createHarness(() => createQuery([
      { type: "system", subtype: "init", session_id: "session_1", uuid: "init_1" },
      { type: "tool_progress", tool_use_id: "toolu_grep", tool_name: "Grep", parent_tool_use_id: null, elapsed_time_seconds: 1, uuid: "tool_progress_1", session_id: "session_1" },
      { type: "tool_use_summary", summary: longSummary, preceding_tool_use_ids: ["toolu_grep"], uuid: "tool_summary_1", session_id: "session_1" },
      createSuccessResult("session_1", "Done")
    ]));

    await runtime.selectSession({ mode: "fresh" });
    await runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "search"
    });

    const completedTool = completed.find((node) => node.node_id === "toolu_grep");
    const summaryDeltas = nodeDeltas.filter((delta) => delta.node_id === "toolu_grep");
    const streamedSummary = summaryDeltas.map((delta) => delta.chunk).join("");
    expect(streamedSummary).toBe(longSummary);
    expect(summaryDeltas.length).toBeGreaterThan(1);
    expect(completedTool?.summary).toBeDefined();
    expect((completedTool?.summary as string).length).toBeLessThanOrEqual(500);
  });

  it("preserves SDK result metadata and fallback text when usage object is omitted", async () => {
    const { runtime } = createHarness(() => createQuery([
      {
        type: "result",
        subtype: "success",
        duration_ms: 3456,
        duration_api_ms: 3000,
        is_error: false,
        num_turns: 3,
        result: "Done from result",
        total_cost_usd: 0.0456,
        terminal_reason: "completed",
        uuid: "result_1",
        session_id: "session_1"
      }
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

    expect(result.finalText).toBe("Done from result");
    expect(result.usage).toMatchObject({
      duration_ms: 3456,
      duration_api_ms: 3000,
      num_turns: 3,
      total_cost_usd: 0.0456,
      terminal_reason: "completed"
    });
  });

  it("routes Bash permission prompts through room-backed approval requests", async () => {
    let permissionResult: Promise<unknown> | undefined;
    const { runtime, approvals, started, updated } = createHarness((_prompt, options) => {
      const canUseTool = options.canUseTool as undefined | ((toolName: string, input: Record<string, unknown>, toolOptions: Record<string, unknown>) => Promise<unknown>);
      if (!canUseTool) throw new Error("missing canUseTool");
      permissionResult = canUseTool("Bash", { command: "pnpm install" }, {
        signal: new AbortController().signal,
        toolUseID: "toolu_bash",
        title: "Claude wants to run Bash",
        displayName: "Run Bash",
        description: "Install dependencies",
        decisionReason: "Command execution needs approval"
      });
      return createQuery([
        { type: "system", subtype: "init", session_id: "session_1", uuid: "init_1" },
        { type: "tool_progress", tool_use_id: "toolu_bash", tool_name: "Bash", parent_tool_use_id: null, elapsed_time_seconds: 7, uuid: "tool_progress_1", session_id: "session_1" },
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
    await expect(permissionResult).resolves.toMatchObject({
      behavior: "allow",
      toolUseID: "toolu_bash",
      updatedInput: { command: "pnpm install" }
    });
    const latestBashUpdate = updated.filter((node) => node.node_id === "toolu_bash").at(-1);
    expect(latestBashUpdate?.detail).toMatchObject({
      tool_name: "Bash",
      input: { command: "pnpm install" },
      elapsed_time_seconds: 7
    });
  });

  it("reuses the first allowed Bash approval for later Bash tools in the same Claude runtime", async () => {
    const permissionResults: Promise<unknown>[] = [];
    const firstInput = { command: "echo first > first.txt" };
    const secondInput = { command: "echo second > second.txt" };
    const { runtime, setQueryImpl, approvals, updated } = createHarness((_prompt, options) => {
      const canUseTool = options.canUseTool as undefined | ((toolName: string, input: Record<string, unknown>, toolOptions: Record<string, unknown>) => Promise<unknown>);
      if (!canUseTool) throw new Error("missing canUseTool");
      permissionResults.push(canUseTool("Bash", firstInput, {
        signal: new AbortController().signal,
        toolUseID: "toolu_bash_first",
        title: "Claude wants to run Bash",
        description: "Create the first file"
      }));
      return createQuery([
        { type: "system", subtype: "init", session_id: "session_1", uuid: "init_1" },
        { type: "tool_progress", tool_use_id: "toolu_bash_first", tool_name: "Bash", parent_tool_use_id: null, elapsed_time_seconds: 1, uuid: "tool_progress_1", session_id: "session_1" },
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
      text: "create first file"
    });

    setQueryImpl((_prompt, options) => {
      const canUseTool = options.canUseTool as undefined | ((toolName: string, input: Record<string, unknown>, toolOptions: Record<string, unknown>) => Promise<unknown>);
      if (!canUseTool) throw new Error("missing canUseTool");
      permissionResults.push(canUseTool("Bash", secondInput, {
        signal: new AbortController().signal,
        toolUseID: "toolu_bash_second",
        title: "Claude wants to run Bash",
        description: "Create the second file"
      }));
      return createQuery([
        { type: "system", subtype: "init", session_id: "session_1", uuid: "init_2" },
        { type: "tool_progress", tool_use_id: "toolu_bash_second", tool_name: "Bash", parent_tool_use_id: null, elapsed_time_seconds: 1, uuid: "tool_progress_2", session_id: "session_1" },
        createSuccessResult("session_1", "Done again")
      ]);
    });

    await runtime.runTurn({
      turnId: "turn_2",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "create second file"
    });

    expect(approvals).toHaveLength(1);
    await expect(permissionResults[0]).resolves.toMatchObject({
      behavior: "allow",
      toolUseID: "toolu_bash_first",
      updatedInput: firstInput
    });
    await expect(permissionResults[1]).resolves.toMatchObject({
      behavior: "allow",
      toolUseID: "toolu_bash_second",
      updatedInput: secondInput
    });
    expect(updated.some((node) => node.node_id === "toolu_bash_second" && node.status === "running")).toBe(true);
  });

  it("returns SDK-valid allow results for auto-allowed Write tools", async () => {
    let permissionResult: Promise<unknown> | undefined;
    const writeInput = {
      file_path: "example.txt",
      content: "Hello from CACP"
    };
    const { runtime, approvals, updated } = createHarness((_prompt, options) => {
      const canUseTool = options.canUseTool as undefined | ((toolName: string, input: Record<string, unknown>, toolOptions: Record<string, unknown>) => Promise<unknown>);
      if (!canUseTool) throw new Error("missing canUseTool");
      permissionResult = canUseTool("Write", writeInput, {
        signal: new AbortController().signal,
        toolUseID: "toolu_write",
        title: "Claude wants to write example.txt"
      });
      return createQuery([
        { type: "system", subtype: "init", session_id: "session_1", uuid: "init_1" },
        { type: "tool_progress", tool_use_id: "toolu_write", tool_name: "Write", parent_tool_use_id: null, elapsed_time_seconds: 1, uuid: "tool_progress_1", session_id: "session_1" },
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
      text: "write file"
    });

    expect(approvals).toHaveLength(0);
    await expect(permissionResult).resolves.toMatchObject({
      behavior: "allow",
      toolUseID: "toolu_write",
      updatedInput: writeInput
    });
    expect(updated.some((node) => node.node_id === "toolu_write" && node.status === "running")).toBe(true);
  });

  it("auto-allows Bash in full access without room approval prompts", async () => {
    let permissionResult: Promise<unknown> | undefined;
    const bashInput = { command: "echo hello > hello.txt" };
    const { runtime, approvals, started, updated } = createHarness((_prompt, options) => {
      const canUseTool = options.canUseTool as undefined | ((toolName: string, input: Record<string, unknown>, toolOptions: Record<string, unknown>) => Promise<unknown>);
      if (!canUseTool) throw new Error("missing canUseTool");
      permissionResult = canUseTool("Bash", bashInput, {
        signal: new AbortController().signal,
        toolUseID: "toolu_bash_full",
        title: "Claude wants to run Bash",
        description: "Create a text file"
      });
      return createQuery([
        { type: "system", subtype: "init", session_id: "session_1", uuid: "init_1" },
        { type: "tool_progress", tool_use_id: "toolu_bash_full", tool_name: "Bash", parent_tool_use_id: null, elapsed_time_seconds: 2, uuid: "tool_progress_1", session_id: "session_1" },
        createSuccessResult("session_1", "Done")
      ]);
    }, { permissionLevel: "full_access" });

    await runtime.selectSession({ mode: "fresh" });
    await runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "create file"
    });

    expect(approvals).toHaveLength(0);
    await expect(permissionResult).resolves.toMatchObject({
      behavior: "allow",
      toolUseID: "toolu_bash_full",
      updatedInput: bashInput
    });
    expect(started.some((node) => node.node_id === "toolu_bash_full" && node.kind === "tool")).toBe(true);
    expect(updated.some((node) => node.node_id === "toolu_bash_full" && node.status === "running")).toBe(true);
  });

  it("preserves assistant tool_use input when progress updates arrive", async () => {
    const { runtime, started, updated } = createHarness(() => createQuery([
      {
        type: "assistant",
        session_id: "session_1",
        uuid: "assistant_1",
        message: {
          content: [
            { type: "tool_use", id: "toolu_read", name: "Read", input: { file_path: "README.md" } }
          ]
        }
      },
      { type: "tool_progress", tool_use_id: "toolu_read", tool_name: "Read", parent_tool_use_id: null, elapsed_time_seconds: 2, uuid: "tool_progress_1", session_id: "session_1" },
      createSuccessResult("session_1", "Done")
    ]));

    await runtime.selectSession({ mode: "fresh" });
    await runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "read docs"
    });

    expect(started.some((node) => node.node_id === "toolu_read" && node.kind === "tool" && node.title === "Read file: README.md")).toBe(true);
    const latestReadUpdate = updated.filter((node) => node.node_id === "toolu_read").at(-1);
    expect(latestReadUpdate?.detail).toMatchObject({
      tool_name: "Read",
      input: { file_path: "README.md" },
      elapsed_time_seconds: 2
    });
  });

  it("attaches SDK tool_result content to the matching tool node output", async () => {
    const toolResult = [
      "Web search results for query: \"重庆天气预报 2026年5月\"",
      "Links:",
      "- Weather in Chongqing in May 2026 - https://example.com/weather"
    ].join("\n");
    const { runtime, nodeDeltas, completed } = createHarness(() => createQuery([
      {
        type: "assistant",
        session_id: "session_1",
        uuid: "assistant_tool_use",
        message: {
          content: [
            { type: "tool_use", id: "toolu_search", name: "WebSearch", input: { query: "重庆天气预报 2026年5月" } }
          ]
        }
      },
      {
        type: "user",
        session_id: "session_1",
        uuid: "user_tool_result",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_search", content: toolResult }
          ]
        }
      },
      createSuccessResult("session_1", "Done")
    ]));

    await runtime.selectSession({ mode: "fresh" });
    await runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "search weather"
    });

    expect(nodeDeltas.filter((delta) => delta.node_id === "toolu_search").map((delta) => delta.chunk).join("")).toBe(toolResult);
    expect(completed.some((node) => node.node_id === "toolu_search")).toBe(true);
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
    const { runtime, started, nodeDeltas, completed } = createHarness(() => createQuery([
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
    const subagentMessage = started.find((node) => node.kind === "subagent_message" && node.parent_node_id === "task_1");
    expect(subagentMessage).toBeDefined();
    expect(subagentMessage).not.toHaveProperty("text");
    expect(nodeDeltas.some((delta) => delta.node_id === subagentMessage?.node_id && delta.chunk === "Subagent reply")).toBe(true);
    expect(started.some((node) => node.node_id === "hook_1" && node.kind === "hook")).toBe(true);
    expect(started.some((node) => node.kind === "api_retry")).toBe(true);
    expect(started.some((node) => node.kind === "compaction")).toBe(true);
    expect(nodeDeltas.some((delta) => delta.node_id === "task_1" && delta.chunk === "Subagent complete")).toBe(true);
    expect(nodeDeltas.some((delta) => delta.node_id === "hook_1" && delta.delta_type === "stdout" && delta.chunk === "ok")).toBe(true);
    expect(completed.some((node) => node.node_id === "task_1" && node.summary === "Subagent complete")).toBe(true);
    expect(completed.some((node) => node.node_id === "hook_1")).toBe(true);
  });
});
