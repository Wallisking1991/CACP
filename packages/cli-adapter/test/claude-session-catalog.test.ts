import { describe, expect, it } from "vitest";
import { listClaudeSessions } from "../src/claude/session-catalog.js";

describe("Claude session catalog", () => {
  it("normalizes SDK sessions and sorts newest first", async () => {
    const sdk = {
      listSessions: async () => [
        { sessionId: "old", summary: "Old", lastModified: 1764268800000, fileSize: 10, cwd: "D:\\Development\\2" },
        { sessionId: "new", summary: "New", lastModified: 1764355200000, fileSize: 20, cwd: "D:\\Development\\2" }
      ],
      getSessionMessages: async (_sessionId: string, _input: { dir: string }) => [
        { uuid: "m1", type: "user", message: { content: "hello" } }
      ]
    };

    const catalog = await listClaudeSessions({ workingDir: "D:\\Development\\2", sdk });

    expect(catalog.workingDir).toBe("D:\\Development\\2");
    expect(catalog.sessions.map((session) => session.session_id)).toEqual(["new", "old"]);
    expect(catalog.sessions[0]).toMatchObject({
      title: "New",
      importable: true,
      message_count: 1,
      byte_size: 20
    });
  });
});
