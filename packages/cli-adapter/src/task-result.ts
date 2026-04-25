import type { RunCommandResult } from "./runner.js";

export type TaskReport =
  | { action: "complete"; body: { exit_code: number } }
  | { action: "fail"; body: { exit_code: number; error: string } };

export function taskReportForExitCode(result: RunCommandResult): TaskReport {
  if (result.exit_code === 0) {
    return { action: "complete", body: { exit_code: result.exit_code } };
  }
  return {
    action: "fail",
    body: {
      exit_code: result.exit_code,
      error: `Command exited with code ${result.exit_code}`
    }
  };
}
