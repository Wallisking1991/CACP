import { describe, expect, it } from "vitest";
import { CopilotRuntime } from "../src/copilot/runtime.js";

function createRuntime(overrides: Record<string, unknown> = {}) {
  const publishedDeltas: string[] = [];
  const started: Array<Record<string, unknown>> = [];
  const nodeDeltas: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const completed: Array<Record<string, unknown>> = [];
  const failed: Array<Record<string, unknown>> = [];

  const runtime = new CopilotRuntime({
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

function createMockSession(eventSequence: Array<{ type: string; data?: Record<string, unknown> }>) {
  const handlers = new Map<string, Array<(event: unknown) => void>>();
  let sendPromise: Promise<void> | undefined;

  const session = {
    sessionId: "session_123",
    async send(options: { prompt: string }) {
      // Simulate events firing after send
      sendPromise = Promise.resolve().then(() => {
        for (const event of eventSequence) {
          const typeHandlers = handlers.get(event.type);
          if (typeHandlers) {
            for (const handler of typeHandlers) {
              handler({ type: event.type, data: event.data });
            }
          }
        }
      });
      return "turn_123";
    },
    async abort() { /* no-op */ },
    async disconnect() { /* no-op */ },
    on(event: string, handler: (event: unknown) => void) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
      return () => {
        const list = handlers.get(event);
        if (list) {
          const idx = list.indexOf(handler);
          if (idx >= 0) list.splice(idx, 1);
        }
      };
    }
  };

  return { session, handlers, getSendPromise: () => sendPromise };
}

describe("Copilot runtime", () => {
  it("requires explicit session selection before running a turn", async () => {
    const { runtime } = createRuntime({
      sdk: {
        createSession: () => { throw new Error("unexpected"); },
        resumeSession: () => { throw new Error("unexpected"); },
        start: () => Promise.resolve(),
        stop: () => Promise.resolve([])
      }
    });

    await expect(runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "hello"
    })).rejects.toThrow("copilot_session_not_selected");
  });

  it("absorbs sdk load failure so the process does not crash from an unhandled rejection", async () => {
    const { runtime } = createRuntime({
      sdk: Promise.reject(new Error("Copilot SDK not installed")) as unknown as {
        createSession: () => never;
        resumeSession: () => never;
        start: () => Promise<void>;
        stop: () => Promise<Error[]>;
      }
    });

    await expect(runtime.selectSession({ mode: "fresh" })).rejects.toThrow("Copilot SDK not installed");
  });

  it("maps assistant message delta and tool events into run-trace nodes", async () => {
    const { session, getSendPromise } = createMockSession([
      { type: "assistant.message_delta", data: { deltaContent: "Hel" } },
      { type: "assistant.message_delta", data: { deltaContent: "lo" } },
      { type: "tool.execution_start", data: { toolCallId: "tool_1", toolName: "read_file" } },
      { type: "tool.execution_complete", data: { toolCallId: "tool_1", result: { summary: "Read package.json" } } },
      { type: "assistant.message", data: { content: "Hello" } },
      { type: "session.idle" }
    ]);

    const { runtime, publishedDeltas, started, completed } = createRuntime({
      sdk: {
        createSession: async () => session,
        resumeSession: async () => session,
        start: () => Promise.resolve(),
        stop: () => Promise.resolve([])
      }
    });

    await runtime.selectSession({ mode: "fresh" });
    const resultPromise = runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "hello"
    });

    // Wait for send to fire events
    await getSendPromise();
    const result = await resultPromise;

    expect(result.finalText).toBe("Hello");
    expect(result.sessionId).toBe("session_123");
    expect(result.metrics.files_read).toBe(1);
    expect(publishedDeltas).toEqual(["Hel", "lo"]);
    expect(started.some((node) => node.node_id === "tool_1" && node.kind === "tool" && String(node.title).includes("read_file"))).toBe(true);
    expect(completed.some((node) => node.node_id === "tool_1")).toBe(true);
  });

  it("counts searches from search tool names", async () => {
    const { session, getSendPromise } = createMockSession([
      { type: "tool.execution_start", data: { toolCallId: "tool_1", toolName: "search" } },
      { type: "tool.execution_complete", data: { toolCallId: "tool_1", result: {} } },
      { type: "tool.execution_start", data: { toolCallId: "tool_2", toolName: "grep" } },
      { type: "tool.execution_complete", data: { toolCallId: "tool_2", result: {} } },
      { type: "assistant.message", data: { content: "Done" } },
      { type: "session.idle" }
    ]);

    const { runtime } = createRuntime({
      sdk: {
        createSession: async () => session,
        resumeSession: async () => session,
        start: () => Promise.resolve(),
        stop: () => Promise.resolve([])
      }
    });

    await runtime.selectSession({ mode: "fresh" });
    const resultPromise = runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "hello"
    });

    await getSendPromise();
    const result = await resultPromise;

    expect(result.metrics.searches).toBe(2);
    expect(result.metrics.files_read).toBe(0);
    expect(result.metrics.commands).toBe(0);
  });

  it("counts commands from shell-like tool names", async () => {
    const { session, getSendPromise } = createMockSession([
      { type: "tool.execution_start", data: { toolCallId: "tool_1", toolName: "run_command" } },
      { type: "tool.execution_complete", data: { toolCallId: "tool_1", result: {} } },
      { type: "assistant.message", data: { content: "Done" } },
      { type: "session.idle" }
    ]);

    const { runtime } = createRuntime({
      sdk: {
        createSession: async () => session,
        resumeSession: async () => session,
        start: () => Promise.resolve(),
        stop: () => Promise.resolve([])
      }
    });

    await runtime.selectSession({ mode: "fresh" });
    const resultPromise = runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "hello"
    });

    await getSendPromise();
    const result = await resultPromise;

    expect(result.metrics.commands).toBe(1);
  });

  it("fails the turn when session.error is received", async () => {
    const { session, getSendPromise } = createMockSession([
      { type: "tool.execution_start", data: { toolCallId: "tool_1", toolName: "read_file" } },
      { type: "session.error", data: { message: "Copilot crashed" } }
    ]);

    const { runtime, failed } = createRuntime({
      sdk: {
        createSession: async () => session,
        resumeSession: async () => session,
        start: () => Promise.resolve(),
        stop: () => Promise.resolve([])
      }
    });

    await runtime.selectSession({ mode: "fresh" });
    const resultPromise = runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "hello"
    });

    await getSendPromise();
    await expect(resultPromise).rejects.toThrow("Copilot crashed");
    expect(failed.some((node) => node.error === "Copilot crashed")).toBe(true);
  });

  it("aborts the active Copilot turn when the runtime closes", async () => {
    let aborted = false;
    const { session } = createMockSession([]);
    const originalAbort = session.abort.bind(session);
    session.abort = async () => { aborted = true; await originalAbort(); };

    const { runtime } = createRuntime({
      sdk: {
        createSession: async () => session,
        resumeSession: async () => session,
        start: () => Promise.resolve(),
        stop: () => Promise.resolve([])
      }
    });

    await runtime.selectSession({ mode: "fresh" });

    // Start a turn that never resolves
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

    await runtime.close();
    expect(aborted).toBe(true);
    await running;
  });

  it("emits a connecting node before send and completes it on first event", async () => {
    const { session, getSendPromise } = createMockSession([
      { type: "assistant.message_delta", data: { deltaContent: "Hi" } },
      { type: "assistant.message", data: { content: "Hi" } },
      { type: "session.idle" }
    ]);

    const { runtime, started, completed } = createRuntime({
      sdk: {
        createSession: async () => session,
        resumeSession: async () => session,
        start: () => Promise.resolve(),
        stop: () => Promise.resolve([])
      }
    });

    await runtime.selectSession({ mode: "fresh" });
    const resultPromise = runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "hello"
    });

    await getSendPromise();
    await resultPromise;

    const connectingStart = started.find((n) => n.node_id === "connecting");
    const connectingComplete = completed.find((n) => n.node_id === "connecting");
    expect(connectingStart).toMatchObject({
      node_id: "connecting",
      kind: "status",
      title: "Connecting",
      status: "running"
    });
    expect(connectingComplete).toBeDefined();
  });

  it("deduplicates metrics by toolCallId", async () => {
    const { session, getSendPromise } = createMockSession([
      { type: "tool.execution_start", data: { toolCallId: "tool_1", toolName: "read_file" } },
      { type: "tool.execution_start", data: { toolCallId: "tool_1", toolName: "read_file" } },
      { type: "tool.execution_complete", data: { toolCallId: "tool_1", result: {} } },
      { type: "assistant.message", data: { content: "Done" } },
      { type: "session.idle" }
    ]);

    const { runtime } = createRuntime({
      sdk: {
        createSession: async () => session,
        resumeSession: async () => session,
        start: () => Promise.resolve(),
        stop: () => Promise.resolve([])
      }
    });

    await runtime.selectSession({ mode: "fresh" });
    const resultPromise = runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "hello"
    });

    await getSendPromise();
    const result = await resultPromise;

    expect(result.metrics.files_read).toBe(1);
  });

  it("uses read_only permission handler to deny shell/write tools", async () => {
    const permissionRequests: Array<{ kind: string }> = [];
    const { session } = createMockSession([]);

    const { runtime } = createRuntime({
      sdk: {
        createSession: async (config: { onPermissionRequest?: (req: { kind: string }) => { kind: string } }) => {
          // Test the permission handler directly
          const handler = config.onPermissionRequest;
          if (handler) {
            permissionRequests.push(handler({ kind: "read" }));
            permissionRequests.push(handler({ kind: "shell" }));
            permissionRequests.push(handler({ kind: "write" }));
          }
          return session;
        },
        resumeSession: async () => session,
        start: () => Promise.resolve(),
        stop: () => Promise.resolve([])
      }
    });

    await runtime.selectSession({ mode: "fresh" });

    expect(permissionRequests).toEqual([
      { kind: "approved" },
      { kind: "denied-interactively-by-user" },
      { kind: "denied-interactively-by-user" }
    ]);
  });

  it("uses default permission handler to approve all tools", async () => {
    const permissionRequests: Array<{ kind: string }> = [];
    const { session } = createMockSession([]);

    const { runtime } = createRuntime({
      permissionLevel: "full_access",
      sdk: {
        createSession: async (config: { onPermissionRequest?: (req: { kind: string }) => { kind: string } }) => {
          const handler = config.onPermissionRequest;
          if (handler) {
            permissionRequests.push(handler({ kind: "read" }));
            permissionRequests.push(handler({ kind: "shell" }));
            permissionRequests.push(handler({ kind: "write" }));
          }
          return session;
        },
        resumeSession: async () => session,
        start: () => Promise.resolve(),
        stop: () => Promise.resolve([])
      }
    });

    await runtime.selectSession({ mode: "fresh" });

    expect(permissionRequests).toEqual([
      { kind: "approved" },
      { kind: "approved" },
      { kind: "approved" }
    ]);
  });

  it("resumes session with correct sessionId", async () => {
    const { session } = createMockSession([
      { type: "assistant.message", data: { content: "Resumed" } },
      { type: "session.idle" }
    ]);

    const { runtime } = createRuntime({
      sdk: {
        createSession: async () => session,
        resumeSession: async (sessionId: string) => {
          expect(sessionId).toBe("prev_session_123");
          return { ...session, sessionId: "prev_session_123" };
        },
        start: () => Promise.resolve(),
        stop: () => Promise.resolve([])
      }
    });

    await runtime.selectSession({ mode: "resume", sessionId: "prev_session_123" });
    expect(runtime).toBeDefined();
  });
});
