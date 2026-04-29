import { describe, expect, it } from "vitest";
import { buildClaudeImportFromSessionMessages, chunkClaudeImportMessages } from "../src/claude/transcript-import.js";

describe("Claude transcript import", () => {
  it("converts visible SDK messages into import payloads", async () => {
    const sdk = {
      getSessionMessages: async (_sessionId: string, _input: { dir: string }) => [
        { uuid: "u1", type: "user", message: { content: "Please inspect the repo" } },
        { uuid: "a1", type: "assistant", message: { content: [{ type: "text", text: "I will inspect it." }] } },
        { uuid: "t1", type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "README.md" } }] } }
      ]
    };

    const result = await buildClaudeImportFromSessionMessages({
      sdk,
      importId: "import_1",
      agentId: "agent_1",
      workingDir: "D:\\Development\\2",
      sessionId: "session_1",
      title: "Planning"
    });

    expect(result.messages).toEqual([
      expect.objectContaining({ sequence: 0, author_role: "user", source_kind: "user", text: "Please inspect the repo" }),
      expect.objectContaining({ sequence: 1, author_role: "assistant", source_kind: "assistant", text: "I will inspect it." }),
      expect.objectContaining({ sequence: 2, author_role: "tool", source_kind: "tool_use", text: "Tool use: Read README.md" })
    ]);
  });

  it("keeps user-side tool results and Bash commands as tool-visible import records", async () => {
    const sdk = {
      getSessionMessages: async (_sessionId: string, _input: { dir: string }) => [
        {
          uuid: "u_tool",
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "README contents" }] }
            ]
          }
        },
        {
          uuid: "a_cmd",
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", id: "toolu_2", name: "Bash", input: { command: "corepack pnpm check" } }
            ]
          }
        }
      ]
    };

    const result = await buildClaudeImportFromSessionMessages({
      sdk,
      importId: "import_1",
      agentId: "agent_1",
      workingDir: "D:\\Development\\2",
      sessionId: "session_1",
      title: "Tools"
    });

    expect(result.messages).toEqual([
      expect.objectContaining({
        sequence: 0,
        author_role: "tool",
        source_kind: "tool_result",
        text: "README contents"
      }),
      expect.objectContaining({
        sequence: 1,
        author_role: "command",
        source_kind: "command",
        text: "Command: corepack pnpm check"
      })
    ]);
  });

  it("chunks imported messages into bounded upload batches", () => {
    const messages = Array.from({ length: 55 }, (_, index) => ({
      import_id: "import_1",
      agent_id: "agent_1",
      session_id: "session_1",
      sequence: index,
      author_role: "assistant" as const,
      source_kind: "assistant" as const,
      text: `message ${index}`
    }));

    expect(chunkClaudeImportMessages(messages, 50).map((chunk) => chunk.length)).toEqual([50, 5]);
  });

  it("splits long visible messages instead of truncating session content", async () => {
    const longText = "x".repeat(45050);
    const sdk = {
      getSessionMessages: async () => [
        { uuid: "a1", type: "assistant", message: { content: [{ type: "text", text: longText }] } }
      ]
    };

    const result = await buildClaudeImportFromSessionMessages({
      sdk,
      importId: "import_1",
      agentId: "agent_1",
      workingDir: "D:\\Development\\2",
      sessionId: "session_1",
      title: "Long session"
    });

    expect(result.messages.map((message) => message.text.length)).toEqual([20000, 20000, 5050]);
    expect(result.messages.map((message) => message.sequence)).toEqual([0, 1, 2]);
    expect(result.messages).toEqual([
      expect.objectContaining({ part_index: 0, part_count: 3, truncated: false }),
      expect.objectContaining({ part_index: 1, part_count: 3, truncated: false }),
      expect.objectContaining({ part_index: 2, part_count: 3, truncated: false })
    ]);
  });

  it("requests system messages and imports safe system metadata", async () => {
    const calls: Array<{ dir: string; includeSystemMessages?: boolean }> = [];
    const result = await buildClaudeImportFromSessionMessages({
      sdk: {
        getSessionMessages: async (_sessionId: string, input: { dir: string; includeSystemMessages?: boolean }) => {
          calls.push(input);
          return [
            { uuid: "sys1", type: "system", message: { content: "Compacted previous conversation" } }
          ];
        }
      },
      importId: "import_1",
      agentId: "agent_1",
      workingDir: "D:\\Development\\2",
      sessionId: "session_1",
      title: "Planning"
    });

    expect(calls).toEqual([{ dir: "D:\\Development\\2", includeSystemMessages: true }]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ author_role: "system", source_kind: "system", text: "Compacted previous conversation" });
  });

});
