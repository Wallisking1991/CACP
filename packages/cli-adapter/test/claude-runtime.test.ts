import { describe, expect, it } from "vitest";
import { ClaudeRuntime } from "../src/claude/runtime.js";

describe("Claude persistent runtime", () => {
  it("requires the owner-selected Claude session before running a turn", async () => {
    let createCalls = 0;
    const sdk = {
      createSession: async () => {
        createCalls += 1;
        return {
          sessionId: "fresh",
          send: async () => undefined,
          stream: async function* () {
            yield { type: "assistant", message: "unexpected" };
          },
          close: async () => undefined
        };
      },
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

    await expect(runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "hello"
    })).rejects.toThrow("claude_session_not_selected");
    expect(createCalls).toBe(0);
  });

  it("configures read-only Claude sessions with read tools instead of plan mode", async () => {
    const createdOptions: unknown[] = [];
    const sdk = {
      createSession: async (options: unknown) => {
        createdOptions.push(options);
        return {
          sessionId: "fresh",
          send: async () => undefined,
          stream: async function* () {},
          close: async () => undefined
        };
      },
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

    expect(createdOptions[0]).toMatchObject({
      workingDir: "D:\\Development\\2",
      includePartialMessages: true,
      settingSources: ["user", "project", "local"],
      permissionMode: "dontAsk",
      allowedTools: ["Read", "Glob", "Grep", "LS"]
    });
  });

  it("resumes one session and reuses it across multiple turns", async () => {
    const prompts: string[] = [];
    let createCalls = 0;
    let resumeCalls = 0;
    const sdk = {
      createSession: async () => {
        createCalls += 1;
        return {
          sessionId: "fresh",
          send: async (prompt: string) => { prompts.push(prompt); },
          stream: async function* () {
            yield { type: "assistant", message: "fresh answer" };
          },
          close: async () => undefined
        };
      },
      resumeSession: async () => {
        resumeCalls += 1;
        return {
          sessionId: "session_1",
          send: async (prompt: string) => { prompts.push(prompt); },
          stream: async function* () {
            yield { type: "assistant", message: "resumed answer" };
          },
          close: async () => undefined
        };
      }
    };
    const statuses: string[] = [];
    const deltas: string[] = [];
    const runtime = new ClaudeRuntime({
      sdk,
      agentId: "agent_1",
      workingDir: "D:\\Development\\2",
      permissionMode: "read_only",
      model: "claude-sonnet-4-20250514",
      publishStatus: async (_turnId, status) => { statuses.push(status.phase); },
      publishDelta: async (_turnId, chunk) => { deltas.push(chunk); }
    });

    await runtime.selectSession({ mode: "resume", sessionId: "session_1" });
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

    expect(createCalls).toBe(0);
    expect(resumeCalls).toBe(1);
    expect(first.finalText).toBe("resumed answer");
    expect(second.finalText).toBe("resumed answer");
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("Message: first");
    expect(prompts[1]).toContain("Message: second");
    expect(statuses).toContain("resuming_session");
    expect(deltas).toEqual(["resumed answer", "resumed answer"]);
  });

  it("extracts text and tool activity from real Claude SDK assistant content blocks", async () => {
    const prompts: string[] = [];
    const sdk = {
      createSession: async () => ({
        sessionId: "session_1",
        send: async (prompt: string) => { prompts.push(prompt); },
        stream: async function* () {
          yield {
            type: "assistant",
            uuid: "assistant_1",
            session_id: "session_1",
            message: {
              id: "msg_1",
              type: "message",
              role: "assistant",
              model: "claude-sonnet-4-20250514",
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 1 },
              content: [
                { type: "text", text: "I will inspect it." },
                { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "README.md" } },
                { type: "text", text: "Done." }
              ]
            }
          };
          yield { type: "system", subtype: "session_state_changed", state: "idle" };
        },
        close: async () => undefined
      }),
      resumeSession: async () => { throw new Error("unexpected"); }
    };
    const statuses: Array<{ phase: string; current: string }> = [];
    const deltas: string[] = [];
    const runtime = new ClaudeRuntime({
      sdk,
      agentId: "agent_1",
      workingDir: "D:\\Development\\2",
      permissionMode: "read_only",
      model: "claude-sonnet-4-20250514",
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
      text: "inspect"
    });

    expect(result.finalText).toBe("I will inspect it.Done.");
    expect(deltas).toEqual(["I will inspect it.Done."]);
    expect(result.metrics.files_read).toBe(1);
    expect(statuses.some((status) => status.phase === "reading_files" && status.current.includes("README.md"))).toBe(true);
    expect(prompts[0]).toContain("Safety/permission:");
    expect(prompts[0]).toContain("Current permission mode: read_only");
  });

  it("breaks stream loop on system session_state_changed idle event", async () => {
    const sdk = {
      createSession: async () => ({
        sessionId: "fresh",
        send: async () => undefined,
        stream: async function* () {
          yield { type: "assistant", message: "partial" };
          yield { type: "system", subtype: "session_state_changed", state: "idle" };
          yield { type: "assistant", message: "should not appear" };
        },
        close: async () => undefined
      }),
      resumeSession: async () => { throw new Error("unexpected"); }
    };
    const deltas: string[] = [];
    const runtime = new ClaudeRuntime({
      sdk,
      agentId: "agent_1",
      workingDir: "D:\\Development\\2",
      permissionMode: "read_only",
      model: "claude-sonnet-4-20250514",
      publishStatus: async () => undefined,
      publishDelta: async (_turnId, chunk) => { deltas.push(chunk); }
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

    expect(result.finalText).toBe("partial");
    expect(deltas).toEqual(["partial"]);
  });
});
