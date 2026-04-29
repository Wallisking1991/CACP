import { describe, expect, it } from "vitest";
import { listClaudeSessions } from "../src/claude/session-catalog.js";

describe("Claude session catalog", () => {
  it("normalizes SDK sessions and sorts newest first", async () => {
    const sdk = {
      listSessions: async () => [
        { sessionId: "old", summary: "Old", lastModified: "2026-04-28T00:00:00.000Z", fileSize: 10, cwd: "D:\\Development\\2" },
        { sessionId: "new", summary: "New", lastModified: "2026-04-29T00:00:00.000Z", fileSize: 20, cwd: "D:\\Development\\2" }
      ]
    };

    const catalog = await listClaudeSessions({ workingDir: "D:\\Development\\2", sdk });

    expect(catalog.workingDir).toBe("D:\\Development\\2");
    expect(catalog.sessions.map((session) => session.session_id)).toEqual(["new", "old"]);
    expect(catalog.sessions[0]).toMatchObject({
      title: "New",
      importable: true,
      byte_size: 20
    });
  });
});
