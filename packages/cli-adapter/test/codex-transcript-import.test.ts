import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCodexImportFromSessionFile } from "../src/codex/transcript-import.js";

describe("Codex transcript import", () => {
  it("imports visible Codex messages, commands, and tool outputs", async () => {
    const root = mkdtempSync(join(tmpdir(), "cacp-codex-import-"));
    try {
      const filePath = join(root, "session.jsonl");
      writeFileSync(filePath, [
        JSON.stringify({ timestamp: "2026-05-01T01:15:01.669Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Hello Codex" }] } }),
        JSON.stringify({ timestamp: "2026-05-01T01:15:10.727Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello room" }], phase: "final_answer" } }),
        JSON.stringify({ timestamp: "2026-05-01T01:17:02.827Z", type: "response_item", payload: { type: "function_call", name: "shell_command", arguments: "{\"command\":\"Get-ChildItem -Force\",\"workdir\":\"D:\\\\Development\\\\2\",\"timeout_ms\":120000}", call_id: "call_1" } }),
        JSON.stringify({ timestamp: "2026-05-01T01:17:10.680Z", type: "response_item", payload: { type: "function_call_output", call_id: "call_1", output: "Exit code: 0\nOutput:\nfile.txt" } })
      ].join("\n"), "utf8");

      const result = await buildCodexImportFromSessionFile({
        importId: "import_1",
        agentId: "agent_1",
        sessionId: "session_1",
        title: "Codex thread",
        filePath
      });

      expect(result.messages.map((message) => message.author_role)).toEqual(["user", "assistant", "command", "tool"]);
      expect(result.messages.map((message) => message.source_kind)).toEqual(["user", "assistant", "command", "tool_result"]);
      expect(result.messages[2].text).toBe("Command: Get-ChildItem -Force");
      expect(result.messages[3].text).toContain("Exit code: 0");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
