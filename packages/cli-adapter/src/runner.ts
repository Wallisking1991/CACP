import { spawn, spawnSync } from "node:child_process";

export interface RunCommandOptions {
  command: string;
  args: string[];
  working_dir: string;
  prompt: string;
  timeout_ms?: number;
  onOutput: (output: { stream: "stdout" | "stderr"; chunk: string }) => void | Promise<void>;
}

export interface RunCommandResult {
  exit_code: number;
}

export function spawnOptionsForPlatform(platform: NodeJS.Platform): { shell: boolean } {
  return { shell: platform === "win32" };
}

function quoteForCmd(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function terminateProcessTree(pid: number | undefined, platform: NodeJS.Platform): void {
  if (!pid) return;
  if (platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process may already have exited.
    }
  }
}

export async function runCommandForTask(options: RunCommandOptions): Promise<RunCommandResult> {
  return await new Promise((resolve, reject) => {
    const pendingOutputs: Promise<void>[] = [];
    let hasOutputError = false;
    let firstOutputError: unknown;
    let timedOut = false;
    const timeoutMs = options.timeout_ms ?? 60_000;
    const spawnOptions = spawnOptionsForPlatform(process.platform);
    const command = spawnOptions.shell
      ? [quoteForCmd(options.command), ...options.args.map(quoteForCmd)].join(" ")
      : options.command;
    const args = spawnOptions.shell ? [] : options.args;

    const child = spawn(command, args, {
      cwd: options.working_dir,
      stdio: ["pipe", "pipe", "pipe"],
      ...spawnOptions
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child.pid, process.platform);
    }, timeoutMs);

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
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      void (async () => {
        clearTimeout(timeout);
        await Promise.all(pendingOutputs);
        if (timedOut) throw new Error(`command timed out after ${timeoutMs}ms`);
        if (hasOutputError) throw firstOutputError;
        return { exit_code: code ?? 1 };
      })().then(resolve, reject);
    });
    child.stdin.write(options.prompt);
    child.stdin.end();
  });
}
