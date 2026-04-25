import { describe, expect, it } from "vitest";
import { runCommandForTask } from "../src/runner.js";

describe("CLI runner", () => {
  it("sends prompt to stdin and captures stdout", async () => {
    const outputs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    const result = await runCommandForTask({
      command: process.execPath,
      args: ["-e", "process.stdin.on('data', d => process.stdout.write('echo:' + d.toString()))"],
      working_dir: process.cwd(),
      prompt: "hello",
      onOutput: (output) => outputs.push(output)
    });
    expect(result.exit_code).toBe(0);
    expect(outputs.map((output) => output.chunk).join("")).toContain("echo:hello");
  });
});