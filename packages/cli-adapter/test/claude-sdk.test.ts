import { describe, expect, it } from "vitest";
import { createClaudeSdkFromModule } from "../src/claude/claude-sdk.js";

describe("Claude SDK boundary", () => {
  it("normalizes v2 create and resume session functions behind local interfaces", async () => {
    const sent: string[] = [];
    const module = {
      unstable_v2_createSession: async () => ({
        sessionId: "fresh_session",
        send: async (prompt: string) => {
          sent.push(prompt);
          return "fresh answer";
        },
        close: async () => undefined
      }),
      unstable_v2_resumeSession: async (sessionId: string) => ({
        sessionId,
        send: async (prompt: string) => {
          sent.push(prompt);
          return "resumed answer";
        },
        close: async () => undefined
      }),
      listSessions: async () => [{ session_id: "session_1", title: "Session", updated_at: "2026-04-29T00:00:00.000Z" }],
      getSessionMessages: async () => [{ id: "m1", role: "assistant", content: "hello" }]
    };

    const sdk = createClaudeSdkFromModule(module);
    const fresh = await sdk.createSession({ workingDir: ".", permissionLevel: "read_only" });
    const resumed = await sdk.resumeSession({ workingDir: ".", sessionId: "session_1", permissionLevel: "read_only" });

    expect(fresh.sessionId).toBe("fresh_session");
    expect(resumed.sessionId).toBe("session_1");
    await fresh.send("hello", { onDelta: async () => undefined, onStatus: async () => undefined });
    expect(sent).toEqual(["hello"]);
  });

  it("throws a clear error when session APIs are missing", () => {
    expect(() => createClaudeSdkFromModule({})).toThrow(/Claude Code Agent SDK session APIs were not found/);
  });
});
