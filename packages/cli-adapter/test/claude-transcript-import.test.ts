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
});
