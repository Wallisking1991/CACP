import { describe, expect, it } from "vitest";
import { createClaudeSdkFromModule } from "../src/claude/claude-sdk.js";

describe("Claude SDK boundary", () => {
  it("normalizes v2 create and resume session functions behind local interfaces", async () => {
    const sent: string[] = [];
    const streamMessages: unknown[] = [{ type: "assistant", message: "fresh answer" }];
    const createOptions: unknown[] = [];
    const resumeOptions: unknown[] = [];
    const module = {
      unstable_v2_createSession: async (options: unknown) => {
        createOptions.push(options);
        return {
        sessionId: "fresh_session",
        send: async (prompt: string) => { sent.push(prompt); },
        stream: async function* () { for (const msg of streamMessages) yield msg; },
        close: async () => undefined
        };
      },
      unstable_v2_resumeSession: async (sessionId: string, options: unknown) => {
        resumeOptions.push(options);
        return {
        sessionId,
        send: async (prompt: string) => { sent.push(prompt); },
        stream: async function* () { yield { type: "assistant", message: "resumed answer" }; },
        close: async () => undefined
        };
      },
      listSessions: async () => [{ sessionId: "session_1", summary: "Session", lastModified: 1764355200000, fileSize: 100 }],
      getSessionMessages: async (_sessionId: string, _input: { dir: string }) => [{ uuid: "m1", type: "assistant", message: "hello" }]
    };

    const sdk = createClaudeSdkFromModule(module);
    const fresh = await sdk.createSession({ workingDir: ".", permissionMode: "read_only", model: "claude-sonnet-4-20250514", includePartialMessages: true, settingSources: ["user", "project", "local"] });
    const resumed = await sdk.resumeSession({ workingDir: ".", sessionId: "session_1", permissionMode: "read_only", model: "claude-sonnet-4-20250514", includePartialMessages: true, settingSources: ["user", "project", "local"] });

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
    expect(createOptions[0]).toMatchObject({ includePartialMessages: true, settingSources: ["user", "project", "local"] });
    expect(resumeOptions[0]).toMatchObject({ includePartialMessages: true, settingSources: ["user", "project", "local"] });
  });

  it("throws a clear error when session APIs are missing", () => {
    expect(() => createClaudeSdkFromModule({})).toThrow(/Claude Code Agent SDK session APIs were not found/);
  });

  it("passes an explicit Claude Code executable path so bundled sessions do not use SDK import.meta resolution", async () => {
    const createOptions: unknown[] = [];
    const resumeOptions: unknown[] = [];
    const module = {
      unstable_v2_createSession: async (options: unknown) => {
        createOptions.push(options);
        return {
          sessionId: "fresh",
          send: async () => undefined,
          stream: async function* () {},
          close: async () => undefined
        };
      },
      unstable_v2_resumeSession: async (_sessionId: string, options: unknown) => {
        resumeOptions.push(options);
        return {
          sessionId: "resumed",
          send: async () => undefined,
          stream: async function* () {},
          close: async () => undefined
        };
      }
    };

    const sdk = createClaudeSdkFromModule(module, {
      resolveClaudeCodeExecutablePath: () => "C:\\Claude\\claude.exe"
    });

    await sdk.createSession({ workingDir: ".", permissionMode: "dontAsk", model: "claude-sonnet-4-20250514" });
    await sdk.resumeSession({ workingDir: ".", sessionId: "session_1", permissionMode: "dontAsk", model: "claude-sonnet-4-20250514" });

    expect(createOptions[0]).toMatchObject({ pathToClaudeCodeExecutable: "C:\\Claude\\claude.exe" });
    expect(resumeOptions[0]).toMatchObject({ pathToClaudeCodeExecutable: "C:\\Claude\\claude.exe" });
  });

  it("handles fresh session sessionId getter throwing", async () => {
    const module = {
      unstable_v2_createSession: async () => ({
        get sessionId() { throw new Error("No session ID on fresh session"); },
        send: async () => undefined,
        stream: async function* () { yield { type: "assistant", message: "hello" }; },
        close: async () => undefined
      }),
      unstable_v2_resumeSession: async () => ({ sessionId: "resumed", send: async () => undefined, stream: async function* () {}, close: async () => undefined }),
      listSessions: async () => [],
      getSessionMessages: async () => []
    };

    const sdk = createClaudeSdkFromModule(module);
    const fresh = await sdk.createSession({ workingDir: ".", permissionMode: "read_only", model: "claude-sonnet-4-20250514" });
    expect(fresh.sessionId).toBeUndefined();
    const resumed = await sdk.resumeSession({ workingDir: ".", sessionId: "s1", permissionMode: "read_only", model: "claude-sonnet-4-20250514" });
    expect(resumed.sessionId).toBe("resumed");
  });
});
