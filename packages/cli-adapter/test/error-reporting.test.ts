import { describe, expect, it, vi } from "vitest";
import { protocolSafeErrorMessage, reportTurnFailure } from "../src/error-reporting.js";

describe("adapter error reporting", () => {
  it("truncates runtime-status errors to the protocol limit", () => {
    const safe = protocolSafeErrorMessage("x".repeat(2500));

    expect(safe).toHaveLength(2000);
    expect(safe).toMatch(/\[truncated]$/);
  });

  it("still reports agent.turn.failed when runtime-status reporting rejects", async () => {
    const reportRuntimeFailure = vi.fn(async () => {
      throw new Error("400 Bad Request");
    });
    const failTurn = vi.fn(async () => undefined);
    const log = vi.fn();

    await reportTurnFailure({
      displayError: "Codex failed",
      reportRuntimeFailure,
      failTurn,
      now: () => "2026-05-01T00:00:00.000Z",
      log
    });

    expect(reportRuntimeFailure).toHaveBeenCalledWith("Codex failed", "2026-05-01T00:00:00.000Z");
    expect(failTurn).toHaveBeenCalledWith("Codex failed");
    expect(log).toHaveBeenCalledWith("Adapter failed to report runtime failure status", expect.any(Error));
  });
});
