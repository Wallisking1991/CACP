import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCodexImportFromSessionFile, findCodexSessionFile } from "../src/codex/transcript-import.js";

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

  it("chunks long Codex transcript parts to protocol-sized import messages", async () => {
    const root = mkdtempSync(join(tmpdir(), "cacp-codex-import-long-"));
    try {
      const filePath = join(root, "session.jsonl");
      const longAnswer = "x".repeat(20001);
      writeFileSync(filePath, [
        JSON.stringify({ type: "session_meta", payload: { id: "session_long", cwd: "D:\\Development\\2" } }),
        JSON.stringify({ timestamp: "2026-05-01T01:15:10.727Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: longAnswer }] } })
      ].join("\n"), "utf8");

      const result = await buildCodexImportFromSessionFile({
        importId: "import_long",
        agentId: "agent_1",
        sessionId: "session_long",
        title: "Long Codex session",
        filePath
      });

      expect(result.messages).toHaveLength(2);
      expect(result.messages.map((message) => message.text.length)).toEqual([20000, 1]);
      expect(result.messages.map((message) => message.sequence)).toEqual([0, 1]);
      expect(result.messages.map((message) => message.part_index)).toEqual([0, 1]);
      expect(result.messages.map((message) => message.part_count)).toEqual([2, 2]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("finds Codex session files by filename before reading metadata", async () => {
    const root = mkdtempSync(join(tmpdir(), "cacp-codex-find-"));
    try {
      const sessionsDir = join(root, "sessions", "2026", "05", "01");
      mkdirSync(sessionsDir, { recursive: true });
      const filePath = join(sessionsDir, "rollout-session_filename_match.jsonl");
      writeFileSync(filePath, "{malformed first line}\n", "utf8");

      await expect(findCodexSessionFile({
        codexHome: root,
        sessionId: "session_filename_match"
      })).resolves.toBe(filePath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses CODEX_HOME when finding Codex session files", async () => {
    const root = mkdtempSync(join(tmpdir(), "cacp-codex-find-env-"));
    const previousCodexHome = process.env.CODEX_HOME;
    try {
      process.env.CODEX_HOME = root;
      const sessionsDir = join(root, "sessions", "2026", "05", "01");
      mkdirSync(sessionsDir, { recursive: true });
      const filePath = join(sessionsDir, "rollout-session_env_lookup.jsonl");
      writeFileSync(filePath, JSON.stringify({
        type: "session_meta",
        payload: { id: "session_env_lookup", cwd: "D:\\Development\\2" }
      }), "utf8");

      await expect(findCodexSessionFile({
        sessionId: "session_env_lookup",
        workingDir: "D:\\Development\\2"
      })).resolves.toBe(filePath);
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not find a Codex session outside the connector working directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "cacp-codex-find-cwd-"));
    try {
      const sessionsDir = join(root, "sessions", "2026", "05", "01");
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(join(sessionsDir, "rollout-session_private_project.jsonl"), JSON.stringify({
        type: "session_meta",
        payload: { id: "session_private_project", cwd: "D:\\PrivateProject" }
      }), "utf8");

      await expect(findCodexSessionFile({
        codexHome: root,
        sessionId: "session_private_project",
        workingDir: "D:\\Development\\2"
      })).resolves.toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
