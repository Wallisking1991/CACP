import { describe, expect, it } from "vitest";
import { listKimiSessions } from "../src/kimi/session-catalog.js";
import type { KimiSdk } from "../src/kimi/types.js";

function mockKimiSdk(
  sessions: Array<{ id: string; workDir: string; contextFile: string; updatedAt: number; brief: string }>,
  eventsBySessionId?: Record<string, unknown[]>
): KimiSdk {
  return {
    createSession: () => ({ sessionId: "s1", workDir: "/p", state: "idle" as const, model: undefined, thinking: false, yoloMode: false, executable: "kimi", env: {}, prompt: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }), interrupt: () => Promise.resolve(), approve: () => Promise.resolve(), result: Promise.resolve({ status: "finished" as const }) }), close: () => Promise.resolve() }),
    listSessions: async () => sessions,
    parseSessionEvents: async (_workDir: string, sessionId: string) => {
      return eventsBySessionId?.[sessionId] ?? [];
    }
  };
}

describe("listKimiSessions", () => {
  it("returns empty sessions when no sessions exist", async () => {
    const sdk = mockKimiSdk([]);
    const result = await listKimiSessions({ workingDir: "/project", sdk });
    expect(result.workingDir).toBe("/project");
    expect(result.sessions).toEqual([]);
  });

  it("normalizes Kimi SDK sessions with events into AgentSessionSummary format", async () => {
    const sdk = mockKimiSdk(
      [{ id: "sess_abc", workDir: "/project", contextFile: "ctx.toml", updatedAt: 1700000000000, brief: "Hello world" }],
      { sess_abc: [{ type: "TurnBegin" }, { type: "ContentPart" }] }
    );
    const result = await listKimiSessions({ workingDir: "/project", sdk });
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toEqual({
      session_id: "sess_abc",
      title: "Hello world",
      project_dir: "/project",
      updated_at: expect.any(String),
      message_count: 2,
      byte_size: 0,
      importable: true,
      provider: "kimi-cli"
    });
  });

  it("marks empty sessions as non-importable", async () => {
    const sdk = mockKimiSdk(
      [{ id: "sess_empty", workDir: "/project", contextFile: "empty.toml", updatedAt: 1700000000000, brief: "" }],
      { sess_empty: [] }
    );
    const result = await listKimiSessions({ workingDir: "/project", sdk });
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].message_count).toBe(0);
    expect(result.sessions[0].importable).toBe(false);
  });

  it("sorts sessions by updatedAt descending", async () => {
    const sdk = mockKimiSdk([
      { id: "old", workDir: "/project", contextFile: "a.toml", updatedAt: 1000, brief: "Old" },
      { id: "new", workDir: "/project", contextFile: "b.toml", updatedAt: 3000, brief: "New" },
      { id: "mid", workDir: "/project", contextFile: "c.toml", updatedAt: 2000, brief: "Mid" }
    ]);
    const result = await listKimiSessions({ workingDir: "/project", sdk });
    expect(result.sessions.map((s) => s.session_id)).toEqual(["new", "mid", "old"]);
  });

  it("uses session id prefix as fallback title when brief is empty", async () => {
    const sdk = mockKimiSdk([
      { id: "sess_xyz789", workDir: "/project", contextFile: "ctx.toml", updatedAt: 1700000000000, brief: "" }
    ]);
    const result = await listKimiSessions({ workingDir: "/project", sdk });
    expect(result.sessions[0].title).toBe("Kimi session sess_xyz");
  });

  it("formats updated_at as ISO string from timestamp", async () => {
    const sdk = mockKimiSdk([
      { id: "s1", workDir: "/project", contextFile: "ctx.toml", updatedAt: 1700000000000, brief: "Test" }
    ]);
    const result = await listKimiSessions({ workingDir: "/project", sdk });
    expect(result.sessions[0].updated_at).toBe(new Date(1700000000000).toISOString());
  });
});
