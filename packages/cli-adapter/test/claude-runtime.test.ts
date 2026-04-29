import { describe, expect, it } from "vitest";
import { ClaudeRuntime } from "../src/claude/runtime.js";

describe("Claude persistent runtime", () => {
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
      systemPrompt: "system",
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
});
