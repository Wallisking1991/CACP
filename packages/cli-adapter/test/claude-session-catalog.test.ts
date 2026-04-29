import { describe, expect, it } from "vitest";
import { listClaudeSessions } from "../src/claude/session-catalog.js";

describe("Claude session catalog", () => {
  it("normalizes SDK sessions and sorts newest first", async () => {
    const sdk = {
      listSessions: async () => [
        { session_id: "old", title: "Old", updated_at: "2026-04-28T00:00:00.000Z", message_count: 1, byte_size: 10, project_dir: "D:\\Development\\2" },
        { session_id: "new", title: "New", updated_at: "2026-04-29T00:00:00.000Z", message_count: 2, byte_size: 20, project_dir: "D:\\Development\\2" }
      ]
    };

    const catalog = await listClaudeSessions({ workingDir: "D:\\Development\\2", sdk });

    expect(catalog.workingDir).toBe("D:\\Development\\2");
    expect(catalog.sessions.map((session) => session.session_id)).toEqual(["new", "old"]);
    expect(catalog.sessions[0]).toMatchObject({
      title: "New",
      importable: true,
      message_count: 2,
      byte_size: 20
    });
  });
});
