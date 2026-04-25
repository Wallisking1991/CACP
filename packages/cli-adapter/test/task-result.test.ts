import { describe, expect, it } from "vitest";
import { taskReportForExitCode } from "../src/task-result.js";

describe("CLI adapter task result reporting", () => {
  it("reports zero exit codes as task completion", () => {
    expect(taskReportForExitCode({ exit_code: 0 })).toEqual({
      action: "complete",
      body: { exit_code: 0 }
    });
  });

  it("reports non-zero exit codes as task failure with useful error text", () => {
    expect(taskReportForExitCode({ exit_code: 7 })).toEqual({
      action: "fail",
      body: { exit_code: 7, error: "Command exited with code 7" }
    });
  });
});
