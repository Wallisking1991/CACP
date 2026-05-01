import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listCodexSessions } from "../src/codex/session-catalog.js";

describe("Codex session catalog", () => {
  it("lists metadata-only Codex SDK sessions for the working directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "cacp-codex-catalog-"));
    try {
      const sessionDir = join(root, "sessions", "2026", "05", "01");
      mkdirSync(sessionDir, { recursive: true });
      const filePath = join(sessionDir, "rollout-2026-05-01T09-15-01-019de11a-76d4-7ca3-96ea-27ad77a12187.jsonl");
      writeFileSync(filePath, [
        JSON.stringify({ timestamp: "2026-05-01T01:15:01.643Z", type: "session_meta", payload: { id: "019de11a-76d4-7ca3-96ea-27ad77a12187", timestamp: "2026-05-01T01:15:01.373Z", cwd: "D:\\Development\\2", originator: "codex_sdk_ts", cli_version: "0.128.0", source: "exec" } }),
        JSON.stringify({ timestamp: "2026-05-01T01:15:01.669Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Hello Codex" }] } }),
        JSON.stringify({ timestamp: "2026-05-01T01:15:10.727Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello room" }] } })
      ].join("\n"), "utf8");

      const catalog = await listCodexSessions({ workingDir: "D:\\Development\\2", codexHome: root });

      expect(catalog.workingDir).toBe("D:\\Development\\2");
      expect(catalog.sessions).toHaveLength(1);
      expect(catalog.sessions[0]).toMatchObject({
        session_id: "019de11a-76d4-7ca3-96ea-27ad77a12187",
        project_dir: "D:\\Development\\2",
        message_count: 2,
        importable: true,
        provider: "codex-cli"
      });
      expect(catalog.sessions[0]).not.toHaveProperty("messages");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
