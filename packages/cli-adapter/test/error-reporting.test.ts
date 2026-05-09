import { describe, expect, it, vi } from "vitest";
import { protocolSafeErrorMessage, reportTurnFailure } from "../src/error-reporting.js";

describe("adapter error reporting", () => {
  it("truncates runtime-status errors to the protocol limit", () => {
    const safe = protocolSafeErrorMessage("x".repeat(2500));

    expect(safe).toHaveLength(2000);
    expect(safe).toMatch(/\[truncated]$/);
  });

  it("reports run failure before failing the turn", async () => {
    const steps: string[] = [];
    const reportRunFailure = vi.fn(async () => {
      steps.push("run");
    });
    const failTurn = vi.fn(async () => {
      steps.push("turn");
    });

    await reportTurnFailure({
      displayError: "Codex failed",
      reportRunFailure,
      failTurn,
      now: () => "2026-05-01T00:00:00.000Z"
    });

    expect(reportRunFailure).toHaveBeenCalledWith("Codex failed", "2026-05-01T00:00:00.000Z");
    expect(failTurn).toHaveBeenCalledWith("Codex failed");
    expect(steps).toEqual(["run", "turn"]);
  });

  it("still reports agent.turn.failed when run-failure reporting rejects", async () => {
    const reportRunFailure = vi.fn(async () => {
      throw new Error("400 Bad Request");
    });
    const failTurn = vi.fn(async () => undefined);
    const log = vi.fn();

    await reportTurnFailure({
      displayError: "Codex failed",
      reportRunFailure,
      failTurn,
      now: () => "2026-05-01T00:00:00.000Z",
      log
    });

    expect(reportRunFailure).toHaveBeenCalledWith("Codex failed", "2026-05-01T00:00:00.000Z");
    expect(failTurn).toHaveBeenCalledWith("Codex failed");
    expect(log).toHaveBeenCalledWith("Adapter failed to report run failure", expect.any(Error));
  });

  it("does not log when run-failure reporting fails with 401 Unauthorized (token expired)", async () => {
    const reportRunFailure = vi.fn(async () => {
      throw new Error("401 Unauthorized: {\"error\":\"invalid_token\"}");
    });
    const failTurn = vi.fn(async () => undefined);
    const log = vi.fn();

    await reportTurnFailure({
      displayError: "Codex failed",
      reportRunFailure,
      failTurn,
      now: () => "2026-05-01T00:00:00.000Z",
      log
    });

    expect(reportRunFailure).toHaveBeenCalledWith("Codex failed", "2026-05-01T00:00:00.000Z");
    expect(failTurn).toHaveBeenCalledWith("Codex failed");
    expect(log).not.toHaveBeenCalled();
  });

  it("does not log when failTurn fails with 401 Unauthorized (token expired)", async () => {
    const reportRunFailure = vi.fn(async () => undefined);
    const failTurn = vi.fn(async () => {
      throw new Error("401 Unauthorized: {\"error\":\"invalid_token\"}");
    });
    const log = vi.fn();

    await reportTurnFailure({
      displayError: "Codex failed",
      reportRunFailure,
      failTurn,
      now: () => "2026-05-01T00:00:00.000Z",
      log
    });

    expect(reportRunFailure).toHaveBeenCalledWith("Codex failed", "2026-05-01T00:00:00.000Z");
    expect(failTurn).toHaveBeenCalledWith("Codex failed");
    expect(log).not.toHaveBeenCalled();
  });
});
