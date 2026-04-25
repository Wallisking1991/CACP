import { spawn } from "node:child_process";

export interface RunCommandOptions {
  command: string;
  args: string[];
  working_dir: string;
  prompt: string;
  onOutput: (output: { stream: "stdout" | "stderr"; chunk: string }) => void | Promise<void>;
}

export interface RunCommandResult {
  exit_code: number;
}

export async function runCommandForTask(options: RunCommandOptions): Promise<RunCommandResult> {
  return await new Promise((resolve, reject) => {
    const pendingOutputs: Promise<void>[] = [];
    let hasOutputError = false;
    let firstOutputError: unknown;

    const child = spawn(options.command, options.args, {
      cwd: options.working_dir,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const captureOutput = (output: { stream: "stdout" | "stderr"; chunk: string }) => {
      const pending = Promise.resolve()
        .then(() => options.onOutput(output))
        .then(
          () => undefined,
          (error) => {
            if (!hasOutputError) {
              hasOutputError = true;
              firstOutputError = error;
            }
          }
        );
      pendingOutputs.push(pending);
    };

    child.stdout.on("data", (chunk: Buffer) => captureOutput({ stream: "stdout", chunk: chunk.toString("utf8") }));
    child.stderr.on("data", (chunk: Buffer) => captureOutput({ stream: "stderr", chunk: chunk.toString("utf8") }));
    child.on("error", reject);
    child.on("close", (code) => {
      void (async () => {
        await Promise.all(pendingOutputs);
        if (hasOutputError) throw firstOutputError;
        return { exit_code: code ?? 1 };
      })().then(resolve, reject);
    });
    child.stdin.write(options.prompt);
    child.stdin.end();
  });
}
