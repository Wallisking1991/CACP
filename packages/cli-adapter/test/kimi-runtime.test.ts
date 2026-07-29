import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KimiRuntime } from "../src/kimi/runtime.js";
import type {
  KimiSdk,
  KimiSdkSession,
  KimiSdkStreamEvent,
  KimiSdkTurn,
} from "../src/kimi/types.js";

function mockTurn(events: KimiSdkStreamEvent[]): KimiSdkTurn {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
    interrupt: vi.fn().mockResolvedValue(undefined),
    approve: vi.fn().mockResolvedValue(undefined),
    respondQuestion: vi.fn().mockResolvedValue(undefined),
    result: Promise.resolve({ status: "finished" as const }),
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
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function mockSdk(turn: KimiSdkTurn): KimiSdk {
  let session = mockSession(turn);
  return {
    createSession: vi.fn((config: Record<string, unknown>) => {
      session = { ...session, thinking: config.thinking === true };
      return session;
    }),
    listSessions: async () => [],
    parseSessionEvents: async () => [],
  };
}

function createRuntime(
  sdk: KimiSdk,
  overrides?: { thinking?: boolean; permissionLevel?: string }
) {
  return new KimiRuntime({
    agentId: "agent_1",
    agentName: "Kimi",
    workingDir: "/project",
    permissionLevel: overrides?.permissionLevel ?? "full_access",
    model: "kimi-latest",
    thinking: overrides?.thinking,
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
    requestApproval: vi.fn().mockResolvedValue({
      decision: "allow" as const,
      resolved_by: "user_1",
      resolved_at: new Date().toISOString(),
    }),
    requestElicitation: vi.fn().mockResolvedValue({
      action: "accept" as const,
      content: { answers: { q1: "yes" } },
      resolved_by: "user_1",
      resolved_at: new Date().toISOString(),
    }),
  });
}

describe("KimiRuntime", () => {
  it("throws when runTurn is called before selectSession", async () => {
    const runtime = createRuntime(mockSdk(mockTurn([])));
    await expect(
      runtime.runTurn({
        turnId: "t1",
        text: "Hello",
        speakerName: "User",
        speakerRole: "member",
        modeLabel: "live",
      })
    ).rejects.toThrow("kimi_session_not_selected");
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
      { type: "ContentPart", payload: { type: "text", text: "world!" } },
    ]);
    const runtime = createRuntime(mockSdk(turn));
    await runtime.selectSession({ mode: "fresh" });

    const result = await runtime.runTurn({
      turnId: "t1",
      text: "Say hello",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live",
    });

    expect(result.finalText).toBe("Hello world!");
  });

  it("sends raster images as data URLs and other attachments as absolute paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "cacp-kimi-input-"));
    const imagePath = join(root, "image.png");
    const pdfPath = join(root, "brief.pdf");
    writeFileSync(imagePath, Buffer.from("image bytes"));
    const turn = mockTurn([]);
    const prompt = vi.fn(() => turn);
    const session = { ...mockSession(turn), prompt };
    const sdk: KimiSdk = {
      createSession: vi.fn(() => session),
      listSessions: async () => [],
      parseSessionEvents: async () => [],
    };
    const runtime = createRuntime(sdk);

    try {
      await runtime.selectSession({ mode: "fresh" });
      await runtime.runTurn({
        turnId: "turn_attachments",
        text: "Inspect the inputs.",
        speakerName: "Owner",
        speakerRole: "owner",
        modeLabel: "normal",
        attachments: [
          {
            attachment_id: "att_image",
            name: "image.png",
            media_type: "image/png",
            size_bytes: 11,
            sha256: "0".repeat(64),
            kind: "image",
            disposition: "inline",
            path: imagePath,
          },
          {
            attachment_id: "att_pdf",
            name: "brief.pdf",
            media_type: "application/pdf",
            size_bytes: 10,
            sha256: "1".repeat(64),
            kind: "pdf",
            disposition: "inline",
            path: pdfPath,
          },
        ],
      });

      expect(prompt).toHaveBeenCalledWith([
        {
          type: "text",
          text: expect.stringContaining(pdfPath),
        },
        {
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${Buffer.from("image bytes").toString("base64")}`,
          },
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("completes successfully with no events", async () => {
    const runtime = createRuntime(mockSdk(mockTurn([])));
    await runtime.selectSession({ mode: "fresh" });

    const result = await runtime.runTurn({
      turnId: "t1",
      text: "Hello",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live",
    });

    expect(result.finalText).toBe("");
    expect(result.sessionId).toBeDefined();
  });

  it("handles ToolCall and ToolResult events", async () => {
    const turn = mockTurn([
      {
        type: "ToolCall",
        payload: {
          type: "function",
          id: "call_1",
          function: { name: "read_file", arguments: "{}" },
        },
      },
      {
        type: "ToolResult",
        payload: {
          tool_call_id: "call_1",
          return_value: {
            is_error: false,
            output: "File content",
            message: "Done",
            display: [],
          },
        },
      },
    ]);
    const runtime = createRuntime(mockSdk(turn));
    await runtime.selectSession({ mode: "fresh" });

    const result = await runtime.runTurn({
      turnId: "t1",
      text: "Read file",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live",
    });

    expect(result.finalText).toBe("");
  });

  it("auto-approves ApprovalRequest when permission level is full_access", async () => {
    const turn = mockTurn([
      {
        type: "ApprovalRequest",
        payload: {
          id: "req_1",
          action: "write_file",
          description: "Write to test.txt",
        },
      },
    ]);
    const runtime = createRuntime(mockSdk(turn));
    runtime["input"].requestApproval = vi
      .fn()
      .mockRejectedValue(new Error("should not be called"));
    await runtime.selectSession({ mode: "fresh" });

    const result = await runtime.runTurn({
      turnId: "t1",
      text: "Write file",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live",
    });

    expect(runtime["input"].requestApproval).not.toHaveBeenCalled();
    expect(turn.approve).toHaveBeenCalledWith("req_1", "approve");
    expect(result.finalText).toBe("");
  });

  it("auto-denies non-read ApprovalRequest when permission level is read_only", async () => {
    const turn = mockTurn([
      {
        type: "ApprovalRequest",
        payload: {
          id: "req_1",
          action: "write_file",
          description: "Write to test.txt",
        },
      },
    ]);
    const runtime = createRuntime(mockSdk(turn), {
      permissionLevel: "read_only",
    });
    runtime["input"].requestApproval = vi
      .fn()
      .mockRejectedValue(new Error("should not be called"));
    await runtime.selectSession({ mode: "fresh" });

    const result = await runtime.runTurn({
      turnId: "t1",
      text: "Write file",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live",
    });

    expect(runtime["input"].requestApproval).not.toHaveBeenCalled();
    expect(turn.approve).toHaveBeenCalledWith("req_1", "reject");
    expect(result.finalText).toBe("");
  });

  it("auto-approves read ApprovalRequest when permission level is read_only", async () => {
    const turn = mockTurn([
      {
        type: "ApprovalRequest",
        payload: {
          id: "req_1",
          action: "read_file",
          description: "Read test.txt",
        },
      },
    ]);
    const runtime = createRuntime(mockSdk(turn), {
      permissionLevel: "read_only",
    });
    runtime["input"].requestApproval = vi
      .fn()
      .mockRejectedValue(new Error("should not be called"));
    await runtime.selectSession({ mode: "fresh" });

    const result = await runtime.runTurn({
      turnId: "t1",
      text: "Read file",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live",
    });

    expect(runtime["input"].requestApproval).not.toHaveBeenCalled();
    expect(turn.approve).toHaveBeenCalledWith("req_1", "approve");
    expect(result.finalText).toBe("");
  });

  it("auto-approves url ApprovalRequest when permission level is limited_write", async () => {
    const turn = mockTurn([
      {
        type: "ApprovalRequest",
        payload: {
          id: "req_1",
          action: "open_url",
          description: "Open https://example.com",
        },
      },
    ]);
    const runtime = createRuntime(mockSdk(turn), {
      permissionLevel: "limited_write",
    });
    runtime["input"].requestApproval = vi
      .fn()
      .mockRejectedValue(new Error("should not be called"));
    await runtime.selectSession({ mode: "fresh" });

    const result = await runtime.runTurn({
      turnId: "t1",
      text: "Open URL",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live",
    });

    expect(runtime["input"].requestApproval).not.toHaveBeenCalled();
    expect(turn.approve).toHaveBeenCalledWith("req_1", "approve");
    expect(result.finalText).toBe("");
  });

  it("auto-denies shell ApprovalRequest when permission level is limited_write", async () => {
    const turn = mockTurn([
      {
        type: "ApprovalRequest",
        payload: { id: "req_1", action: "bash_command", description: "Run ls" },
      },
    ]);
    const runtime = createRuntime(mockSdk(turn), {
      permissionLevel: "limited_write",
    });
    runtime["input"].requestApproval = vi
      .fn()
      .mockRejectedValue(new Error("should not be called"));
    await runtime.selectSession({ mode: "fresh" });

    const result = await runtime.runTurn({
      turnId: "t1",
      text: "Run command",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live",
    });

    expect(runtime["input"].requestApproval).not.toHaveBeenCalled();
    expect(turn.approve).toHaveBeenCalledWith("req_1", "reject");
    expect(result.finalText).toBe("");
  });

  it("falls back to read_only when permission level is undefined", async () => {
    const turn = mockTurn([
      {
        type: "ApprovalRequest",
        payload: {
          id: "req_1",
          action: "write_file",
          description: "Write to test.txt",
        },
      },
    ]);
    const runtime = new KimiRuntime({
      agentId: "agent_1",
      agentName: "Kimi",
      workingDir: "/project",
      model: "kimi-latest",
      sdk: mockSdk(turn),
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
      requestApproval: vi
        .fn()
        .mockRejectedValue(new Error("should not be called")),
    });
    await runtime.selectSession({ mode: "fresh" });

    const result = await runtime.runTurn({
      turnId: "t1",
      text: "Write file",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live",
    });

    expect(runtime["input"].requestApproval).not.toHaveBeenCalled();
    expect(turn.approve).toHaveBeenCalledWith("req_1", "reject");
    expect(result.finalText).toBe("");
  });

  it("handles SubagentEvent", async () => {
    const turn = mockTurn([
      {
        type: "SubagentEvent",
        payload: {
          parent_tool_call_id: "call_1",
          event: { type: "StepBegin", payload: { n: 1 } },
        },
      },
    ]);
    const runtime = createRuntime(mockSdk(turn));
    await runtime.selectSession({ mode: "fresh" });

    const result = await runtime.runTurn({
      turnId: "t1",
      text: "Run subagent",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live",
    });

    expect(result.finalText).toBe("");
  });

  it("counts tool metrics correctly", async () => {
    const turn = mockTurn([
      {
        type: "ToolCall",
        payload: {
          type: "function",
          id: "call_1",
          function: { name: "Read", arguments: "{}" },
        },
      },
      {
        type: "ToolResult",
        payload: {
          tool_call_id: "call_1",
          return_value: {
            is_error: false,
            output: "",
            message: "Done",
            display: [],
          },
        },
      },
      {
        type: "ToolCall",
        payload: {
          type: "function",
          id: "call_2",
          function: { name: "Bash", arguments: "{}" },
        },
      },
      {
        type: "ToolResult",
        payload: {
          tool_call_id: "call_2",
          return_value: {
            is_error: false,
            output: "",
            message: "Done",
            display: [],
          },
        },
      },
    ]);
    const runtime = createRuntime(mockSdk(turn));
    await runtime.selectSession({ mode: "fresh" });

    const result = await runtime.runTurn({
      turnId: "t1",
      text: "Run tools",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live",
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

  it("passes thinking option to SDK createSession", async () => {
    const sdk = mockSdk(mockTurn([]));
    const runtime = createRuntime(sdk, { thinking: true });
    await runtime.selectSession({ mode: "fresh" });
    expect(sdk.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ thinking: true })
    );
  });

  it("does not add think content to final text or publish it as delta", async () => {
    const turn = mockTurn([
      {
        type: "ContentPart",
        payload: { type: "think", think: "Let me think..." },
      },
      { type: "ContentPart", payload: { type: "text", text: "Final answer" } },
    ]);
    const sdk = mockSdk(turn);
    const publishDelta = vi.fn().mockResolvedValue(undefined);
    const startNode = vi.fn().mockResolvedValue(undefined);
    const appendNodeDelta = vi.fn().mockResolvedValue(undefined);
    const completeNode = vi.fn().mockResolvedValue(undefined);
    const runtime = new KimiRuntime({
      agentId: "agent_1",
      agentName: "Kimi",
      workingDir: "/project",
      permissionLevel: "full_access",
      model: "kimi-latest",
      thinking: true,
      sdk,
      turnId: "turn_1",
      text: "Hello",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live",
      roomName: "Test Room",
      publishDelta,
      startNode,
      appendNodeDelta,
      updateNode: vi.fn().mockResolvedValue(undefined),
      completeNode,
      failNode: vi.fn().mockResolvedValue(undefined),
      requestApproval: vi.fn().mockResolvedValue({
        decision: "allow" as const,
        resolved_by: "user_1",
        resolved_at: new Date().toISOString(),
      }),
    });
    await runtime.selectSession({ mode: "fresh" });

    const result = await runtime.runTurn({
      turnId: "t1",
      text: "Hello",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live",
    });

    expect(result.finalText).toBe("Final answer");
    expect(publishDelta).not.toHaveBeenCalledWith("t1", "Let me think...");
    expect(publishDelta).toHaveBeenCalledWith("t1", "Final answer");

    expect(startNode).toHaveBeenCalledWith(
      expect.objectContaining({
        node_id: "kimi_reasoning_t1",
        kind: "reasoning_summary",
        title: "Thinking",
      })
    );
    expect(appendNodeDelta).toHaveBeenCalledWith(
      expect.objectContaining({
        node_id: "kimi_reasoning_t1",
        delta_type: "text",
        chunk: "Let me think...",
      })
    );
    expect(completeNode).toHaveBeenCalledWith(
      expect.objectContaining({
        node_id: "kimi_reasoning_t1",
        summary: "Thinking complete",
      })
    );
  });

  it("defaults thinking to false when not specified", async () => {
    const sdk = mockSdk(mockTurn([]));
    const runtime = createRuntime(sdk); // no thinking override
    await runtime.selectSession({ mode: "fresh" });
    expect(sdk.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ thinking: false })
    );
  });

  it("handles interleaved think and text content parts", async () => {
    const turn = mockTurn([
      { type: "ContentPart", payload: { type: "think", think: "Part 1." } },
      { type: "ContentPart", payload: { type: "text", text: "Hello " } },
      { type: "ContentPart", payload: { type: "think", think: " Part 2." } },
      { type: "ContentPart", payload: { type: "text", text: "world!" } },
    ]);
    const sdk = mockSdk(turn);
    const publishDelta = vi.fn().mockResolvedValue(undefined);
    const startNode = vi.fn().mockResolvedValue(undefined);
    const appendNodeDelta = vi.fn().mockResolvedValue(undefined);
    const completeNode = vi.fn().mockResolvedValue(undefined);
    const runtime = new KimiRuntime({
      agentId: "agent_1",
      agentName: "Kimi",
      workingDir: "/project",
      permissionLevel: "full_access",
      model: "kimi-latest",
      thinking: true,
      sdk,
      turnId: "turn_1",
      text: "Hello",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live",
      roomName: "Test Room",
      publishDelta,
      startNode,
      appendNodeDelta,
      updateNode: vi.fn().mockResolvedValue(undefined),
      completeNode,
      failNode: vi.fn().mockResolvedValue(undefined),
      requestApproval: vi.fn().mockResolvedValue({
        decision: "allow" as const,
        resolved_by: "user_1",
        resolved_at: new Date().toISOString(),
      }),
    });
    await runtime.selectSession({ mode: "fresh" });

    const result = await runtime.runTurn({
      turnId: "t1",
      text: "Say hello",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live",
    });

    expect(result.finalText).toBe("Hello world!");

    expect(publishDelta).toHaveBeenCalledWith("t1", "Hello ");
    expect(publishDelta).toHaveBeenCalledWith("t1", "world!");
    expect(publishDelta).not.toHaveBeenCalledWith("t1", "Part 1.");
    expect(publishDelta).not.toHaveBeenCalledWith("t1", " Part 2.");

    expect(startNode).toHaveBeenCalledWith(
      expect.objectContaining({
        node_id: "kimi_reasoning_t1",
        kind: "reasoning_summary",
        title: "Thinking",
      })
    );
    expect(appendNodeDelta).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        node_id: "kimi_reasoning_t1",
        delta_type: "text",
        chunk: "Part 1.",
      })
    );
    expect(appendNodeDelta).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        node_id: "kimi_reasoning_t1",
        delta_type: "text",
        chunk: " Part 2.",
      })
    );
    expect(completeNode).toHaveBeenCalledWith(
      expect.objectContaining({
        node_id: "kimi_reasoning_t1",
        summary: "Thinking complete",
      })
    );
  });

  it("setThinking updates session.thinking when session exists", async () => {
    const sdk = mockSdk(mockTurn([]));
    const runtime = createRuntime(sdk, { thinking: true });
    await runtime.selectSession({ mode: "fresh" });

    const session = vi.mocked(sdk.createSession).mock.results[0]
      .value as KimiSdkSession;
    expect(session.thinking).toBe(true);

    runtime.setThinking(false);
    expect(session.thinking).toBe(false);

    runtime.setThinking(true);
    expect(session.thinking).toBe(true);
  });

  it("setThinking stores desired state before session is selected", async () => {
    const sdk = mockSdk(mockTurn([]));
    const runtime = createRuntime(sdk, { thinking: true });

    // Toggle before selectSession — should not throw and should remember state
    runtime.setThinking(false);

    await runtime.selectSession({ mode: "fresh" });
    const session = vi.mocked(sdk.createSession).mock.results[0]
      .value as KimiSdkSession;
    expect(session.thinking).toBe(false);
  });

  it("handles QuestionRequest via elicitation flow", async () => {
    const questionEvent: KimiSdkStreamEvent = {
      type: "QuestionRequest",
      payload: {
        id: "qreq_1",
        tool_call_id: "call_1",
        questions: [
          {
            question: "Should I proceed?",
            options: [
              { label: "yes", description: "Proceed with the operation" },
              { label: "no", description: "Cancel the operation" },
            ],
          },
        ],
      },
    };
    const turn = mockTurn([questionEvent]);
    const requestElicitation = vi.fn().mockResolvedValue({
      action: "accept" as const,
      content: { answers: { "0": "yes" } },
      resolved_by: "user_1",
      resolved_at: new Date().toISOString(),
    });
    const runtime = new KimiRuntime({
      agentId: "agent_1",
      agentName: "Kimi",
      workingDir: "/project",
      permissionLevel: "full_access",
      model: "kimi-latest",
      sdk: mockSdk(turn),
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
      requestApproval: vi.fn().mockResolvedValue({
        decision: "allow" as const,
        resolved_by: "user_1",
        resolved_at: new Date().toISOString(),
      }),
      requestElicitation,
    });
    await runtime.selectSession({ mode: "fresh" });

    const result = await runtime.runTurn({
      turnId: "t1",
      text: "Ask a question",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live",
    });

    expect(result.finalText).toBe("");
    expect(requestElicitation).toHaveBeenCalled();
    expect(turn.respondQuestion).toHaveBeenCalledWith("qreq_1", "qreq_1", {
      "0": "yes",
    });
  });

  it("rejects QuestionRequest when user declines", async () => {
    const questionEvent: KimiSdkStreamEvent = {
      type: "QuestionRequest",
      payload: {
        id: "qreq_1",
        tool_call_id: "call_1",
        questions: [
          {
            question: "Should I proceed?",
            options: [{ label: "yes" }, { label: "no" }],
          },
        ],
      },
    };
    const turn = mockTurn([questionEvent]);
    const requestElicitation = vi.fn().mockResolvedValue({
      action: "decline" as const,
      resolved_by: "user_1",
      resolved_at: new Date().toISOString(),
    });
    const runtime = new KimiRuntime({
      agentId: "agent_1",
      agentName: "Kimi",
      workingDir: "/project",
      permissionLevel: "full_access",
      model: "kimi-latest",
      sdk: mockSdk(turn),
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
      requestApproval: vi.fn().mockResolvedValue({
        decision: "allow" as const,
        resolved_by: "user_1",
        resolved_at: new Date().toISOString(),
      }),
      requestElicitation,
    });
    await runtime.selectSession({ mode: "fresh" });

    await runtime.runTurn({
      turnId: "t1",
      text: "Ask a question",
      speakerName: "User",
      speakerRole: "member",
      modeLabel: "live",
    });

    expect(requestElicitation).toHaveBeenCalled();
    expect(turn.respondQuestion).toHaveBeenCalledWith("qreq_1", "qreq_1", {});
  });
});
