import { describe, expect, it, vi } from "vitest";
import { createClaudeSdkFromModule } from "../src/claude/claude-sdk.js";

function createQuery(messages: unknown[], onClose = vi.fn()) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) yield message;
    },
    close: onClose
  };
}

describe("Claude SDK boundary", () => {
  it("normalizes query() behind local interfaces and forwards source-true options", async () => {
    const closed = vi.fn();
    const queryCalls: Array<{ prompt: string; options: Record<string, unknown> }> = [];
    const module = {
      query: ({ prompt, options }: { prompt: string; options: Record<string, unknown> }) => {
        queryCalls.push({ prompt, options });
        return createQuery([
          { type: "system", subtype: "init", session_id: "session_1", uuid: "u1" }
        ], closed);
      },
      listSessions: async () => [{ sessionId: "session_1", summary: "Session", lastModified: 1764355200000, fileSize: 100 }],
      getSessionMessages: async (_sessionId: string, _input: { dir: string }) => [{ uuid: "m1", type: "assistant", message: "hello" }]
    };

    const sdk = createClaudeSdkFromModule(module, {
      resolveClaudeCodeExecutablePath: () => "C:\\Claude\\claude.exe"
    });

    const query = sdk.query({
      prompt: "hello",
      options: {
        cwd: ".",
        model: "claude-sonnet-4-20250514",
        permissionMode: "default",
        settingSources: ["user", "project", "local"],
        includePartialMessages: true,
        includeHookEvents: true,
        forwardSubagentText: true,
        toolConfig: { askUserQuestion: { previewFormat: "html" } },
        canUseTool: async () => ({ behavior: "allow" }),
        onElicitation: async () => ({ action: "cancel" })
      }
    });

    const messages: unknown[] = [];
    for await (const message of query) messages.push(message);
    query.close();

    expect(queryCalls[0]).toMatchObject({
      prompt: "hello",
      options: {
        cwd: ".",
        model: "claude-sonnet-4-20250514",
        permissionMode: "default",
        settingSources: ["user", "project", "local"],
        includePartialMessages: true,
        includeHookEvents: true,
        forwardSubagentText: true,
        toolConfig: { askUserQuestion: { previewFormat: "html" } },
        pathToClaudeCodeExecutable: "C:\\Claude\\claude.exe"
      }
    });
    expect(messages).toHaveLength(1);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("keeps listSessions and getSessionMessages available for catalog and import flows", async () => {
    const module = {
      query: () => createQuery([]),
      listSessions: async () => [{ sessionId: "session_1", summary: "Session", lastModified: 1764355200000, fileSize: 100 }],
      getSessionMessages: async (_sessionId: string, _input: { dir: string }) => [{ uuid: "m1", type: "assistant", message: "hello" }]
    };

    const sdk = createClaudeSdkFromModule(module);

    await expect(sdk.listSessions({ dir: "." })).resolves.toHaveLength(1);
    await expect(sdk.getSessionMessages("session_1", { dir: ".", includeSystemMessages: true })).resolves.toHaveLength(1);
  });

  it("throws a clear error when the query API is missing", () => {
    expect(() => createClaudeSdkFromModule({})).toThrow(/query API/i);
  });
});
