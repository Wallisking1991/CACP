import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommandForTask, spawnOptionsForPlatform } from "../src/runner.js";

const nodeEchoScript = "process.stdin.on('data', d => process.stdout.write('echo:' + d.toString()))";

describe("CLI runner", () => {
  it("sends prompt to stdin and captures stdout", async () => {
    const outputs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    const result = await runCommandForTask({
      command: process.execPath,
      args: ["-e", nodeEchoScript],
      working_dir: process.cwd(),
      prompt: "hello",
      onOutput: (output) => {
        outputs.push(output);
      }
    });
    expect(result.exit_code).toBe(0);
    expect(outputs.map((output) => output.chunk).join("")).toContain("echo:hello");
  });

  it("waits for async output callbacks before resolving", async () => {
    let completed = false;

    const result = await runCommandForTask({
      command: process.execPath,
      args: ["-e", "process.stdout.write('ready')"],
      working_dir: process.cwd(),
      prompt: "",
      onOutput: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        completed = true;
      }
    });

    expect(result.exit_code).toBe(0);
    expect(completed).toBe(true);
  });

  it("delivers output chunks before the command exits", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cacp-stream-"));
    const markerPath = join(tempDir, "first-output-seen");
    const received: string[] = [];

    try {
      const result = await runCommandForTask({
        command: process.execPath,
        args: [
          "-e",
          [
            "const { existsSync } = require('node:fs');",
            "const markerPath = process.argv[1];",
            "process.stdout.write('first');",
            "setTimeout(() => {",
            "  process.stdout.write(existsSync(markerPath) ? 'seen-before-exit' : 'missed-before-exit');",
            "  process.exit(0);",
            "}, 500);"
          ].join(" "),
          markerPath
        ],
        working_dir: process.cwd(),
        prompt: "",
        onOutput: (output) => {
          received.push(output.chunk);
          if (output.chunk.includes("first") && !existsSync(markerPath)) writeFileSync(markerPath, "seen", "utf8");
        }
      });

      const joined = received.join("");
      expect(result.exit_code).toBe(0);
      expect(joined).toContain("first");
      expect(joined).toContain("seen-before-exit");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects when an async output callback rejects", async () => {
    await expect(
      runCommandForTask({
        command: process.execPath,
        args: ["-e", "process.stdout.write('bad')"],
        working_dir: process.cwd(),
        prompt: "",
        onOutput: async () => {
          throw new Error("output post failed");
        }
      })
    ).rejects.toThrow("output post failed");
  });

  it("streams stderr", async () => {
    const outputs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    const result = await runCommandForTask({
      command: process.execPath,
      args: ["-e", "process.stderr.write('warn')"],
      working_dir: process.cwd(),
      prompt: "",
      onOutput: (output) => {
        outputs.push(output);
      }
    });

    expect(result.exit_code).toBe(0);
    expect(outputs).toContainEqual({ stream: "stderr", chunk: "warn" });
  });

  it("resolves with the command exit code when non-zero", async () => {
    const result = await runCommandForTask({
      command: process.execPath,
      args: ["-e", "process.exit(7)"],
      working_dir: process.cwd(),
      prompt: "",
      onOutput: () => undefined
    });

    expect(result.exit_code).toBe(7);
  });

  it("does not create a timeout when timeout_ms is omitted", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    try {
      const result = await runCommandForTask({
        command: process.execPath,
        args: ["-e", "process.stdout.write('done')"],
        working_dir: process.cwd(),
        prompt: "",
        onOutput: () => undefined
      });
      expect(result.exit_code).toBe(0);
      expect(setTimeoutSpy).not.toHaveBeenCalled();
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("rejects and stops commands that exceed the timeout", async () => {
    const startedAt = Date.now();

    await expect(
      runCommandForTask({
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        working_dir: process.cwd(),
        prompt: "",
        timeout_ms: 200,
        onOutput: () => undefined
      })
    ).rejects.toThrow("command timed out after 200ms");

    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  it("uses a shell on Windows so trusted npm/pnpm/cmd shims can run", () => {
    expect(spawnOptionsForPlatform("win32").shell).toBe(true);
    expect(spawnOptionsForPlatform("linux").shell).toBe(false);
  });
});
