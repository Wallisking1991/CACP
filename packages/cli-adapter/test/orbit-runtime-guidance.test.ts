import { describe, expect, it, vi } from "vitest";
import { ClaudeRuntime } from "../src/claude/runtime.js";
import { CodexRuntime } from "../src/codex/runtime.js";

describe("Claude runtime orbit guidance", () => {
  it("includes CACP_ORBIT_DISCUSSION guidance in the turn prompt", async () => {
    const prompts: string[] = [];
    const sdk = {
      query: ({ prompt }: { prompt: string }) => {
        prompts.push(prompt);
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: "system", subtype: "init", session_id: "session_1", uuid: "init_1" };
            yield { type: "assistant", parent_tool_use_id: null, uuid: "assistant_1", session_id: "session_1", message: { content: [{ type: "text", text: "answer" }] } };
            yield {
              type: "result",
              subtype: "success",
              duration_ms: 1000,
              duration_api_ms: 800,
              is_error: false,
              num_turns: 1,
              result: "answer",
              stop_reason: "end_turn",
              total_cost_usd: 0.001,
              usage: { input_tokens: 10, output_tokens: 20 },
              modelUsage: {},
              permission_denials: [],
              uuid: "result_1",
              session_id: "session_1"
            };
          },
          close: vi.fn()
        };
      }
    };
    const runtime = new ClaudeRuntime({
      sdk,
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
      requestElicitation: async () => ({ action: "cancel", resolved_by: "user_1", resolved_at: "2026-05-05T00:00:00.000Z" })
    });

    await runtime.selectSession({ mode: "fresh" });
    await runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "hello"
    });

    const prompt = prompts[0];
    expect(prompt).toContain("CACP_ORBIT_DISCUSSION");
    expect(prompt).toContain("not a direct command");
  });
});

describe("Codex runtime orbit guidance", () => {
  it("includes CACP_ORBIT_DISCUSSION guidance in the turn prompt", async () => {
    const prompts: string[] = [];
    const mockThread = {
      id: "thread_1",
      runStreamed: async (prompt: string, _options: unknown) => {
        prompts.push(prompt);
        return {
          events: (async function* () {
            yield { type: "turn.started" };
            yield { type: "item.completed", item: { type: "agent_message", text: "ok" } };
            yield { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } };
          })()
        };
      }
    };
    const mockSdk = {
      startThread: () => mockThread,
      resumeThread: () => mockThread
    };
    const runtime = new CodexRuntime({
      sdk: mockSdk,
      agentId: "agent_1",
      workingDir: "D:\\Development\\2",
      permissionLevel: "read_only",
      publishDelta: async () => undefined,
      startNode: async () => undefined,
      appendNodeDelta: async () => undefined,
      updateNode: async () => undefined,
      completeNode: async () => undefined,
      failNode: async () => undefined
    });

    await runtime.selectSession({ mode: "fresh" });
    await runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "hello"
    });

    const prompt = prompts[0];
    expect(prompt).toContain("CACP_ORBIT_DISCUSSION");
    expect(prompt).toContain("not a direct command");
  });
});
