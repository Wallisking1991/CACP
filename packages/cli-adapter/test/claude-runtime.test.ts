import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeRuntime } from "../src/claude/runtime.js";

function createQuery(messages: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const message of messages) yield message;
    },
    close: vi.fn(),
  };
}

function createSuccessResult(sessionId = "session_1", result = "answer") {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 1000,
    duration_api_ms: 800,
    is_error: false,
    num_turns: 1,
    result,
    stop_reason: "end_turn",
    total_cost_usd: 0.001,
    usage: { input_tokens: 10, output_tokens: 20 },
    modelUsage: {},
    permission_denials: [],
    uuid: "result_1",
    session_id: sessionId,
  };
}

function createRuntime(overrides: Record<string, unknown> = {}) {
  const sinkCalls: Array<{ method: string; payload: Record<string, unknown> }> =
    [];
  const runtime = new ClaudeRuntime({
    agentId: "agent_1",
    workingDir: "D:\\Development\\2",
    permissionLevel: "read_only",
    model: "claude-sonnet-4-20250514",
    publishDelta: async () => undefined,
    startNode: async (payload: Record<string, unknown>) => {
      sinkCalls.push({ method: "startNode", payload });
    },
    appendNodeDelta: async (payload: Record<string, unknown>) => {
      sinkCalls.push({ method: "appendNodeDelta", payload });
    },
    updateNode: async (payload: Record<string, unknown>) => {
      sinkCalls.push({ method: "updateNode", payload });
    },
    completeNode: async (payload: Record<string, unknown>) => {
      sinkCalls.push({ method: "completeNode", payload });
    },
    failNode: async (payload: Record<string, unknown>) => {
      sinkCalls.push({ method: "failNode", payload });
    },
    requestApproval: async () => ({
      decision: "allow",
      resolved_by: "user_1",
      resolved_at: "2026-05-05T00:00:00.000Z",
    }),
    requestElicitation: async () => ({
      action: "cancel",
      resolved_by: "user_1",
      resolved_at: "2026-05-05T00:00:00.000Z",
    }),
    ...overrides,
  });
  return { runtime, sinkCalls };
}

describe("Claude runtime", () => {
  it("absorbs sdk load failure so the process does not crash from an unhandled rejection", async () => {
    const { runtime } = createRuntime({
      sdk: Promise.reject(new Error("Claude SDK not installed")) as unknown as {
        query: () => never;
      },
    });

    await expect(runtime.selectSession({ mode: "fresh" })).rejects.toThrow(
      "Claude SDK not installed"
    );
  });

  it("requires an owner-selected Claude session before running a turn", async () => {
    const sdk = {
      query: () => createQuery([{ type: "assistant", message: "unexpected" }]),
    };
    const { runtime } = createRuntime({ sdk });

    await expect(
      runtime.runTurn({
        turnId: "turn_1",
        roomName: "Room",
        speakerName: "Owner",
        speakerRole: "owner",
        modeLabel: "normal",
        text: "hello",
      })
    ).rejects.toThrow("claude_session_not_selected");
  });

  it("uses query() with source-true options for a fresh selection and captures the created session id", async () => {
    const queryCalls: Array<{
      prompt: string;
      options: Record<string, unknown>;
    }> = [];
    const deltas: string[] = [];
    const sdk = {
      query: ({
        prompt,
        options,
      }: {
        prompt: string;
        options: Record<string, unknown>;
      }) => {
        queryCalls.push({ prompt, options });
        return createQuery([
          {
            type: "system",
            subtype: "init",
            session_id: "session_1",
            uuid: "init_1",
          },
          {
            type: "assistant",
            parent_tool_use_id: null,
            uuid: "assistant_1",
            session_id: "session_1",
            message: { content: [{ type: "text", text: "answer" }] },
          },
          createSuccessResult("session_1", "answer"),
        ]);
      },
    };
    const { runtime } = createRuntime({
      sdk,
      publishDelta: async (_turnId: string, chunk: string) => {
        deltas.push(chunk);
      },
    });

    await runtime.selectSession({ mode: "fresh" });
    const result = await runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "hello",
    });

    expect(queryCalls[0]?.options).toMatchObject({
      cwd: "D:\\Development\\2",
      model: "claude-sonnet-4-20250514",
      permissionMode: "default",
      settingSources: ["user", "project", "local"],
      includePartialMessages: true,
      includeHookEvents: true,
      forwardSubagentText: true,
      toolConfig: { askUserQuestion: { previewFormat: "html" } },
    });
    expect(queryCalls[0]?.options).not.toHaveProperty("resume");
    expect(result.sessionId).toBe("session_1");
    expect(result.finalText).toBe("answer");
    expect(deltas).toEqual(["answer"]);
  });

  it("sends images and PDFs natively while describing other files by absolute path", async () => {
    const root = mkdtempSync(join(tmpdir(), "cacp-claude-input-"));
    const imagePath = join(root, "image.png");
    const pdfPath = join(root, "brief.pdf");
    writeFileSync(imagePath, Buffer.from("image bytes"));
    writeFileSync(pdfPath, Buffer.from("pdf bytes"));
    let capturedPrompt: unknown;
    const sdk = {
      query: ({ prompt }: { prompt: unknown }) => {
        capturedPrompt = prompt;
        return createQuery([
          {
            type: "system",
            subtype: "init",
            session_id: "session_1",
            uuid: "init_1",
          },
          createSuccessResult(),
        ]);
      },
    };
    const { runtime } = createRuntime({ sdk });

    try {
      await runtime.selectSession({ mode: "fresh" });
      await runtime.runTurn({
        turnId: "turn_attachments",
        roomName: "Room",
        speakerName: "Owner",
        speakerRole: "owner",
        modeLabel: "normal",
        text: "Review these files.",
        attachments: [
          {
            attachment_id: "att_image",
            name: "image.png",
            media_type: "image/png",
            size_bytes: 11,
            sha256: "0".repeat(64),
            kind: "image",
            disposition: "inline",
            path: imagePath,
          },
          {
            attachment_id: "att_pdf",
            name: "brief.pdf",
            media_type: "application/pdf",
            size_bytes: 9,
            sha256: "1".repeat(64),
            kind: "pdf",
            disposition: "inline",
            path: pdfPath,
          },
          {
            attachment_id: "att_text",
            name: "notes.txt",
            media_type: "text/plain",
            size_bytes: 3,
            sha256: "2".repeat(64),
            kind: "text",
            disposition: "inline",
            path: join(root, "notes.txt"),
          },
        ],
      });

      const messages: unknown[] = [];
      for await (const message of capturedPrompt as AsyncIterable<unknown>)
        messages.push(message);
      const content = (
        messages[0] as {
          message: { content: Array<Record<string, unknown>> };
        }
      ).message.content;
      expect(content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining(join(root, "notes.txt")),
      });
      expect(content[1]).toMatchObject({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: Buffer.from("image bytes").toString("base64"),
        },
      });
      expect(content[2]).toMatchObject({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: Buffer.from("pdf bytes").toString("base64"),
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reuses the selected resume session across multiple turns", async () => {
    const queryCalls: Array<{
      prompt: string;
      options: Record<string, unknown>;
    }> = [];
    const sdk = {
      query: ({
        prompt,
        options,
      }: {
        prompt: string;
        options: Record<string, unknown>;
      }) => {
        queryCalls.push({ prompt, options });
        return createQuery([
          {
            type: "system",
            subtype: "init",
            session_id: "session_9",
            uuid: `init_${queryCalls.length}`,
          },
          {
            type: "assistant",
            parent_tool_use_id: null,
            uuid: `assistant_${queryCalls.length}`,
            session_id: "session_9",
            message: { content: [{ type: "text", text: "resumed answer" }] },
          },
          createSuccessResult("session_9", "resumed answer"),
        ]);
      },
    };
    const { runtime } = createRuntime({ sdk });

    await runtime.selectSession({ mode: "resume", sessionId: "session_9" });
    const first = await runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "first",
    });
    const second = await runtime.runTurn({
      turnId: "turn_2",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "second",
    });

    expect(queryCalls.map((call) => call.options.resume)).toEqual([
      "session_9",
      "session_9",
    ]);
    expect(first.finalText).toBe("resumed answer");
    expect(second.finalText).toBe("resumed answer");
    expect(queryCalls[0]?.prompt).toBe("Owner(owner): first");
    expect(queryCalls[1]?.prompt).toBe("Owner(owner): second");
  });

  it("emits a connecting node before query and completes it on first stream message", async () => {
    const sdk = {
      query: () =>
        createQuery([
          {
            type: "system",
            subtype: "init",
            session_id: "session_1",
            uuid: "init_1",
          },
          {
            type: "assistant",
            parent_tool_use_id: null,
            uuid: "assistant_1",
            session_id: "session_1",
            message: { content: [{ type: "text", text: "hello" }] },
          },
          createSuccessResult("session_1", "hello"),
        ]),
    };
    const { runtime, sinkCalls } = createRuntime({ sdk });

    await runtime.selectSession({ mode: "fresh" });
    await runtime.runTurn({
      turnId: "turn_1",
      roomName: "Room",
      speakerName: "Owner",
      speakerRole: "owner",
      modeLabel: "normal",
      text: "hi",
    });

    const connectingStartIndex = sinkCalls.findIndex(
      (c) => c.method === "startNode" && c.payload.node_id === "connecting"
    );
    const connectingCompleteIndex = sinkCalls.findIndex(
      (c) => c.method === "completeNode" && c.payload.node_id === "connecting"
    );

    expect(connectingStartIndex).toBeGreaterThanOrEqual(0);
    expect(sinkCalls[connectingStartIndex]?.payload).toMatchObject({
      node_id: "connecting",
      kind: "status",
      title: "Connecting",
      status: "running",
    });
    expect(connectingCompleteIndex).toBeGreaterThan(connectingStartIndex);
    expect(sinkCalls[connectingCompleteIndex]?.payload).toMatchObject({
      node_id: "connecting",
    });
  });
});
