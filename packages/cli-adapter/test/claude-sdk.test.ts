import { describe, expect, it } from "vitest";
import { createClaudeSdkFromModule } from "../src/claude/claude-sdk.js";

describe("Claude SDK boundary", () => {
  it("normalizes v2 create and resume session functions behind local interfaces", async () => {
    const sent: string[] = [];
    const streamMessages: unknown[] = [{ type: "assistant", message: "fresh answer" }];
    const module = {
      unstable_v2_createSession: async () => ({
        sessionId: "fresh_session",
        send: async (prompt: string) => { sent.push(prompt); },
        stream: async function* () { for (const msg of streamMessages) yield msg; },
        close: async () => undefined
      }),
      unstable_v2_resumeSession: async (sessionId: string) => ({
        sessionId,
        send: async (prompt: string) => { sent.push(prompt); },
        stream: async function* () { yield { type: "assistant", message: "resumed answer" }; },
        close: async () => undefined
      }),
      listSessions: async () => [{ sessionId: "session_1", summary: "Session", lastModified: 1764355200000, fileSize: 100 }],
      getSessionMessages: async (_sessionId: string, _input: { dir: string }) => [{ uuid: "m1", type: "assistant", message: "hello" }]
    };

    const sdk = createClaudeSdkFromModule(module);
    const fresh = await sdk.createSession({ workingDir: ".", permissionMode: "read_only", model: "claude-sonnet-4-20250514" });
    const resumed = await sdk.resumeSession({ workingDir: ".", sessionId: "session_1", permissionMode: "read_only", model: "claude-sonnet-4-20250514" });

    expect(fresh.sessionId).toBe("fresh_session");
    expect(resumed.sessionId).toBe("session_1");
    await fresh.send("hello");
    const chunks: string[] = [];
    for await (const msg of fresh.stream()) {
      const record = msg as Record<string, unknown>;
      if (record.type === "assistant") chunks.push(String(record.message));
    }
    expect(chunks).toEqual(["fresh answer"]);
    expect(sent).toEqual(["hello"]);
  });

  it("throws a clear error when session APIs are missing", () => {
    expect(() => createClaudeSdkFromModule({})).toThrow(/Claude Code Agent SDK session APIs were not found/);
  });
});
