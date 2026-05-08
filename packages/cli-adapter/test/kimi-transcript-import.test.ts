import { describe, expect, it } from "vitest";
import { buildKimiImportFromSessionEvents, chunkKimiImportMessages } from "../src/kimi/transcript-import.js";
import type { KimiSdk, KimiSdkStreamEvent } from "../src/kimi/types.js";

function mockKimiSdk(events: KimiSdkStreamEvent[]): KimiSdk {
  return {
    createSession: () => ({ sessionId: "s1", workDir: "/p", state: "idle" as const, model: undefined, thinking: false, yoloMode: false, executable: "kimi", env: {}, prompt: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }), interrupt: () => Promise.resolve(), approve: () => Promise.resolve(), result: Promise.resolve({ status: "finished" as const }) }), close: () => Promise.resolve() }),
    listSessions: async () => [],
    parseSessionEvents: async () => events
  };
}

describe("buildKimiImportFromSessionEvents", () => {
  it("returns empty messages when no events", async () => {
    const sdk = mockKimiSdk([]);
    const result = await buildKimiImportFromSessionEvents({ sdk, agentId: "agent_1", workingDir: "/p", sessionId: "s1", title: "Test" });
    expect(result.messages).toEqual([]);
    expect(result.sessionId).toBe("s1");
    expect(result.title).toBe("Test");
  });

  it("imports TurnBegin as user message", async () => {
    const sdk = mockKimiSdk([
      { type: "TurnBegin", payload: { user_input: "Hello Kimi" } }
    ]);
    const result = await buildKimiImportFromSessionEvents({ sdk, agentId: "agent_1", workingDir: "/p", sessionId: "s1", title: "Test" });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].author_role).toBe("user");
    expect(result.messages[0].source_kind).toBe("user");
    expect(result.messages[0].text).toBe("Hello Kimi");
  });

  it("imports ContentPart text as assistant message", async () => {
    const sdk = mockKimiSdk([
      { type: "ContentPart", payload: { type: "text", text: "Sure, I can help." } }
    ]);
    const result = await buildKimiImportFromSessionEvents({ sdk, agentId: "agent_1", workingDir: "/p", sessionId: "s1", title: "Test" });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].author_role).toBe("assistant");
    expect(result.messages[0].source_kind).toBe("assistant");
    expect(result.messages[0].text).toBe("Sure, I can help.");
  });

  it("imports ContentPart think as assistant message", async () => {
    const sdk = mockKimiSdk([
      { type: "ContentPart", payload: { type: "think", think: "Let me think..." } }
    ]);
    const result = await buildKimiImportFromSessionEvents({ sdk, agentId: "agent_1", workingDir: "/p", sessionId: "s1", title: "Test" });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].author_role).toBe("assistant");
    expect(result.messages[0].text).toBe("Let me think...");
  });

  it("imports ToolCall as tool_use message", async () => {
    const sdk = mockKimiSdk([
      { type: "ToolCall", payload: { type: "function", id: "call_1", function: { name: "read_file", arguments: "{\"path\":\"test.txt\"}" } } }
    ]);
    const result = await buildKimiImportFromSessionEvents({ sdk, agentId: "agent_1", workingDir: "/p", sessionId: "s1", title: "Test" });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].author_role).toBe("tool");
    expect(result.messages[0].source_kind).toBe("tool_use");
    expect(result.messages[0].text).toContain("read_file");
  });

  it("imports ToolResult as tool_result message", async () => {
    const sdk = mockKimiSdk([
      { type: "ToolResult", payload: { tool_call_id: "call_1", return_value: { is_error: false, output: "File content here", message: "Done", display: [] } } }
    ]);
    const result = await buildKimiImportFromSessionEvents({ sdk, agentId: "agent_1", workingDir: "/p", sessionId: "s1", title: "Test" });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].author_role).toBe("tool");
    expect(result.messages[0].source_kind).toBe("tool_result");
    expect(result.messages[0].text).toBe("File content here");
  });

  it("sequences messages in order", async () => {
    const sdk = mockKimiSdk([
      { type: "TurnBegin", payload: { user_input: "Q1" } },
      { type: "ContentPart", payload: { type: "text", text: "A1" } },
      { type: "TurnBegin", payload: { user_input: "Q2" } },
      { type: "ContentPart", payload: { type: "text", text: "A2" } }
    ]);
    const result = await buildKimiImportFromSessionEvents({ sdk, agentId: "agent_1", workingDir: "/p", sessionId: "s1", title: "Test" });
    expect(result.messages).toHaveLength(4);
    expect(result.messages[0].sequence).toBe(0);
    expect(result.messages[1].sequence).toBe(1);
    expect(result.messages[2].sequence).toBe(2);
    expect(result.messages[3].sequence).toBe(3);
    expect(result.messages[0].text).toBe("Q1");
    expect(result.messages[1].text).toBe("A1");
  });

  it("ignores unknown event types", async () => {
    const sdk = mockKimiSdk([
      { type: "TurnBegin", payload: { user_input: "Hello" } },
      { type: "StatusUpdate", payload: { token_usage: { input_other: 10, output: 20 } } },
      { type: "ContentPart", payload: { type: "text", text: "Hi" } }
    ]);
    const result = await buildKimiImportFromSessionEvents({ sdk, agentId: "agent_1", workingDir: "/p", sessionId: "s1", title: "Test" });
    expect(result.messages).toHaveLength(2);
  });
});

describe("chunkKimiImportMessages", () => {
  it("chunks messages into groups of given size", () => {
    const messages = Array.from({ length: 5 }, (_, i) => ({
      import_id: "imp_1", agent_id: "a1", session_id: "s1", sequence: i,
      author_role: "user" as const, source_kind: "user" as const, text: `msg ${i}`
    }));
    const chunks = chunkKimiImportMessages(messages, 2);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(2);
    expect(chunks[1]).toHaveLength(2);
    expect(chunks[2]).toHaveLength(1);
  });
});
