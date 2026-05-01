import { describe, expect, it } from "vitest";
import { ClaudeRuntime } from "../src/claude/runtime.js";
import { CodexRuntime } from "../src/codex/runtime.js";

describe("Claude runtime orbit guidance", () => {
  it("includes CACP_ORBIT_DISCUSSION guidance in the turn prompt", async () => {
    const prompts: string[] = [];
    const sdk = {
      createSession: async () => ({
        sessionId: "session_1",
        send: async (prompt: string) => { prompts.push(prompt); },
        stream: async function* () {
          yield { type: "assistant", message: "answer" };
          yield { type: "system", subtype: "session_state_changed", state: "idle" };
        },
        close: async () => undefined
      }),
      resumeSession: async () => { throw new Error("unexpected"); }
    };
    const runtime = new ClaudeRuntime({
      sdk,
      agentId: "agent_1",
      workingDir: "D:\\Development\\2",
      permissionMode: "read_only",
      model: "claude-sonnet-4-20250514",
      publishStatus: async () => undefined,
      publishDelta: async () => undefined
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
            yield { type: "turn.completed" };
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
      publishStatus: async () => undefined,
      publishDelta: async () => undefined
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
