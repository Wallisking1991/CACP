import { describe, expect, it, vi } from "vitest";
import { KimiRuntime } from "../src/kimi/runtime.js";
import type { KimiSdk, KimiSdkSession, KimiSdkStreamEvent, KimiSdkTurn } from "../src/kimi/types.js";

function mockTurn(events: KimiSdkStreamEvent[]): KimiSdkTurn {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
    interrupt: vi.fn().mockResolvedValue(undefined),
    approve: vi.fn().mockResolvedValue(undefined),
    result: Promise.resolve({ status: "finished" as const })
  };
}

function mockSession(turn: KimiSdkTurn): KimiSdkSession {
  return {
    sessionId: "sess_123",
    workDir: "/project",
    state: "idle",
    model: undefined,
    thinking: false,
    yoloMode: false,
    executable: "kimi",
    env: {},
    prompt: () => turn,
    close: vi.fn().mockResolvedValue(undefined)
  };
}

function mockSdk(turn: KimiSdkTurn): KimiSdk {
  const session = mockSession(turn);
  return {
    createSession: () => session,
    listSessions: async () => [],
    parseSessionEvents: async () => []
  };
}

function createRuntime(sdk: KimiSdk) {
  return new KimiRuntime({
    agentId: "agent_1",
    agentName: "Kimi",
    workingDir: "/project",
    permissionLevel: "full_access",
    model: "kimi-latest",
    sdk,
    turnId: "turn_1",
    text: "Hello",
    speakerName: "User",
    speakerRole: "member",
    modeLabel: "live",
    roomName: "Test Room",
    publishDelta: vi.fn().mockResolvedValue(undefined),
    startNode: vi.fn().mockResolvedValue(undefined),
    appendNodeDelta: vi.fn().mockResolvedValue(undefined),
    updateNode: vi.fn().mockResolvedValue(undefined),
    completeNode: vi.fn().mockResolvedValue(undefined),
    failNode: vi.fn().mockResolvedValue(undefined),
    requestApproval: vi.fn().mockResolvedValue({ decision: "allow" as const, resolved_by: "user_1", resolved_at: new Date().toISOString() })
  });
}

describe("KimiRuntime", () => {
  it("throws when runTurn is called before selectSession", async () => {
    const runtime = createRuntime(mockSdk(mockTurn([])));
    await expect(runtime.runTurn({
      turnId: "t1",
      text: "Hello",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live"
    })).rejects.toThrow("kimi_session_not_selected");
  });

  it("selects a fresh session", async () => {
    const runtime = createRuntime(mockSdk(mockTurn([])));
    await runtime.selectSession({ mode: "fresh" });
    // Should not throw
  });

  it("selects a resumed session", async () => {
    const runtime = createRuntime(mockSdk(mockTurn([])));
    await runtime.selectSession({ mode: "resume", sessionId: "sess_old" });
    // Should not throw
  });

  it("streams ContentPart text as deltas", async () => {
    const turn = mockTurn([
      { type: "ContentPart", payload: { type: "text", text: "Hello " } },
      { type: "ContentPart", payload: { type: "text", text: "world!" } }
    ]);
    const runtime = createRuntime(mockSdk(turn));
    await runtime.selectSession({ mode: "fresh" });

    const result = await runtime.runTurn({
      turnId: "t1",
      text: "Say hello",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live"
    });

    expect(result.finalText).toBe("Hello world!");
  });

  it("completes successfully with no events", async () => {
    const runtime = createRuntime(mockSdk(mockTurn([])));
    await runtime.selectSession({ mode: "fresh" });

    const result = await runtime.runTurn({
      turnId: "t1",
      text: "Hello",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live"
    });

    expect(result.finalText).toBe("");
    expect(result.sessionId).toBeDefined();
  });

  it("handles ToolCall and ToolResult events", async () => {
    const turn = mockTurn([
      { type: "ToolCall", payload: { type: "function", id: "call_1", function: { name: "read_file", arguments: "{}" } } },
      { type: "ToolResult", payload: { tool_call_id: "call_1", return_value: { is_error: false, output: "File content", message: "Done", display: [] } } }
    ]);
    const runtime = createRuntime(mockSdk(turn));
    await runtime.selectSession({ mode: "fresh" });

    const result = await runtime.runTurn({
      turnId: "t1",
      text: "Read file",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live"
    });

    expect(result.finalText).toBe("");
  });

  it("handles ApprovalRequest by requesting approval", async () => {
    const approvalEvent: KimiSdkStreamEvent = {
      type: "ApprovalRequest",
      payload: { id: "req_1", action: "write_file", description: "Write to test.txt" }
    };
    const turn = mockTurn([approvalEvent]);
    const runtime = createRuntime(mockSdk(turn));
    await runtime.selectSession({ mode: "fresh" });

    const result = await runtime.runTurn({
      turnId: "t1",
      text: "Write file",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live"
    });

    expect(turn.approve).toHaveBeenCalledWith("req_1", "approve");
    expect(result.finalText).toBe("");
  });

  it("rejects approval when denied", async () => {
    const turn = mockTurn([
      { type: "ApprovalRequest", payload: { id: "req_1", action: "delete_file", description: "Delete test.txt" } }
    ]);
    const runtime = createRuntime(mockSdk(turn));
    runtime["input"].requestApproval = vi.fn().mockResolvedValue({
      decision: "deny" as const,
      resolved_by: "user_1",
      resolved_at: new Date().toISOString(),
      reason: "Too risky"
    });
    await runtime.selectSession({ mode: "fresh" });

    await runtime.runTurn({
      turnId: "t1",
      text: "Delete file",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live"
    });

    expect(turn.approve).toHaveBeenCalledWith("req_1", "reject");
  });

  it("handles SubagentEvent", async () => {
    const turn = mockTurn([
      { type: "SubagentEvent", payload: { parent_tool_call_id: "call_1", event: { type: "StepBegin", payload: { n: 1 } } } }
    ]);
    const runtime = createRuntime(mockSdk(turn));
    await runtime.selectSession({ mode: "fresh" });

    const result = await runtime.runTurn({
      turnId: "t1",
      text: "Run subagent",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live"
    });

    expect(result.finalText).toBe("");
  });

  it("counts tool metrics correctly", async () => {
    const turn = mockTurn([
      { type: "ToolCall", payload: { type: "function", id: "call_1", function: { name: "Read", arguments: "{}" } } },
      { type: "ToolResult", payload: { tool_call_id: "call_1", return_value: { is_error: false, output: "", message: "Done", display: [] } } },
      { type: "ToolCall", payload: { type: "function", id: "call_2", function: { name: "Bash", arguments: "{}" } } },
      { type: "ToolResult", payload: { tool_call_id: "call_2", return_value: { is_error: false, output: "", message: "Done", display: [] } } }
    ]);
    const runtime = createRuntime(mockSdk(turn));
    await runtime.selectSession({ mode: "fresh" });

    const result = await runtime.runTurn({
      turnId: "t1",
      text: "Run tools",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live"
    });

    expect(result.metrics.files_read).toBe(1);
    expect(result.metrics.commands).toBe(1);
  });

  it("closes without errors", async () => {
    const runtime = createRuntime(mockSdk(mockTurn([])));
    await runtime.selectSession({ mode: "fresh" });
    await runtime.close();
    // Should not throw
  });
});
