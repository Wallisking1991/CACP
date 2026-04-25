import { describe, expect, it } from "vitest";
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

  it("uses a shell on Windows so trusted npm/pnpm/cmd shims can run", () => {
    expect(spawnOptionsForPlatform("win32").shell).toBe(true);
    expect(spawnOptionsForPlatform("linux").shell).toBe(false);
  });
});
