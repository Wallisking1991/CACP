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

function createSuccessResult(sessionId = "session_1", result = "answer") {
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

function createRuntime(overrides: Record<string, unknown> = {}) {
  return new ClaudeRuntime({
    agentId: "agent_1",
    workingDir: "D:\\Development\\2",
    permissionLevel: "read_only",
    model: "claude-sonnet-4-20250514",
    publishDelta: async () => undefined,
    startNode: async () => undefined,
    appendNodeDelta: async () => undefined,
    updateNode: async () => undefined,
    completeNode: async () => undefined,
    failNode: async () => undefined,
    requestApproval: async () => ({ decision: "allow", resolved_by: "user_1", resolved_at: "2026-05-05T00:00:00.000Z" }),
    requestElicitation: async () => ({ action: "cancel", resolved_by: "user_1", resolved_at: "2026-05-05T00:00:00.000Z" }),
    ...overrides
  });
}

describe("Claude runtime", () => {
  it("absorbs sdk load failure so the process does not crash from an unhandled rejection", async () => {
    const runtime = createRuntime({
      sdk: Promise.reject(new Error("Claude SDK not installed")) as unknown as { query: () => never }
    });

    await expect(runtime.selectSession({ mode: "fresh" })).rejects.toThrow("Claude SDK not installed");
  });

  it("requires an owner-selected Claude session before running a turn", async () => {
    const sdk = {
      query: () => createQuery([{ type: "assistant", message: "unexpected" }])
    };
    const runtime = createRuntime({ sdk });

    await expect(runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "hello"
    })).rejects.toThrow("claude_session_not_selected");
  });

  it("uses query() with source-true options for a fresh selection and captures the created session id", async () => {
    const queryCalls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    const deltas: string[] = [];
    const sdk = {
      query: ({ prompt, options }: { prompt: string; options: Record<string, unknown> }) => {
        queryCalls.push({ prompt, options });
        return createQuery([
          { type: "system", subtype: "init", session_id: "session_1", uuid: "init_1" },
          {
            type: "assistant",
            parent_tool_use_id: null,
            uuid: "assistant_1",
            session_id: "session_1",
            message: { content: [{ type: "text", text: "answer" }] }
          },
          createSuccessResult("session_1", "answer")
        ]);
      }
    };
    const runtime = createRuntime({
      sdk,
      publishDelta: async (_turnId: string, chunk: string) => { deltas.push(chunk); }
    });

    await runtime.selectSession({ mode: "fresh" });
    const result = await runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "hello"
    });

    expect(queryCalls[0]?.options).toMatchObject({
      cwd: "D:\\Development\\2",
      model: "claude-sonnet-4-20250514",
      permissionMode: "default",
      settingSources: ["user", "project", "local"],
      includePartialMessages: true,
      includeHookEvents: true,
      forwardSubagentText: true,
      toolConfig: { askUserQuestion: { previewFormat: "html" } }
    });
    expect(queryCalls[0]?.options).not.toHaveProperty("resume");
    expect(result.sessionId).toBe("session_1");
    expect(result.finalText).toBe("answer");
    expect(deltas).toEqual(["answer"]);
  });

  it("reuses the selected resume session across multiple turns", async () => {
    const queryCalls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    const sdk = {
      query: ({ prompt, options }: { prompt: string; options: Record<string, unknown> }) => {
        queryCalls.push({ prompt, options });
        return createQuery([
          { type: "system", subtype: "init", session_id: "session_9", uuid: `init_${queryCalls.length}` },
          {
            type: "assistant",
            parent_tool_use_id: null,
            uuid: `assistant_${queryCalls.length}`,
            session_id: "session_9",
            message: { content: [{ type: "text", text: "resumed answer" }] }
          },
          createSuccessResult("session_9", "resumed answer")
        ]);
      }
    };
    const runtime = createRuntime({ sdk });

    await runtime.selectSession({ mode: "resume", sessionId: "session_9" });
    const first = await runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "first"
    });
    const second = await runtime.runTurn({
      turnId: "turn_2",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "second"
    });

    expect(queryCalls.map((call) => call.options.resume)).toEqual(["session_9", "session_9"]);
    expect(first.finalText).toBe("resumed answer");
    expect(second.finalText).toBe("resumed answer");
    expect(queryCalls[0]?.prompt).toContain("Message: first");
    expect(queryCalls[1]?.prompt).toContain("Message: second");
  });
});
