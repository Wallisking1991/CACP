import { spawn } from "node:child_process";

export interface RunCommandOptions {
  command: string;
  args: string[];
  working_dir: string;
  prompt: string;
  onOutput: (output: { stream: "stdout" | "stderr"; chunk: string }) => unknown;
}

export interface RunCommandResult {
  exit_code: number;
}

export async function runCommandForTask(options: RunCommandOptions): Promise<RunCommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.working_dir,
      stdio: ["pipe", "pipe", "pipe"]
    });
    child.stdout.on("data", (chunk: Buffer) => void options.onOutput({ stream: "stdout", chunk: chunk.toString("utf8") }));
    child.stderr.on("data", (chunk: Buffer) => void options.onOutput({ stream: "stderr", chunk: chunk.toString("utf8") }));
    child.on("error", reject);
    child.on("close", (code) => resolve({ exit_code: code ?? 1 }));
    child.stdin.write(options.prompt);
    child.stdin.end();
  });
}
