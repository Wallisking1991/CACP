import { describe, expect, it, vi } from "vitest";
import { handleFatalError, shouldPauseBeforeFatalExit } from "../src/fatal-error.js";

describe("fatal connector errors", () => {
  it("pauses after fatal errors when the packaged connector was double-clicked", () => {
    expect(shouldPauseBeforeFatalExit({
      argv: ["C:\\Tools\\CACP-Local-Connector.exe"],
      execPath: "C:\\Tools\\CACP-Local-Connector.exe",
      stdinIsTTY: true
    })).toBe(true);
  });

  it("does not pause normal developer CLI failures", () => {
    expect(shouldPauseBeforeFatalExit({
      argv: ["C:\\Program Files\\nodejs\\node.exe", "D:\\Development\\2\\packages\\cli-adapter\\dist\\index.js"],
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      stdinIsTTY: true
    })).toBe(false);
  });

  it("prints the fatal message and waits before exiting in double-click mode", async () => {
    const stderr: string[] = [];
    const pause = vi.fn(async () => {});
    const exit = vi.fn();

    await handleFatalError(new Error("CACP connection code expired."), {
      argv: ["C:\\Tools\\CACP-Local-Connector.exe"],
      execPath: "C:\\Tools\\CACP-Local-Connector.exe",
      stdinIsTTY: true,
      writeError: (line) => stderr.push(line),
      pause,
      exit
    });

    expect(stderr.join("\n")).toContain("CACP Local Connector failed.");
    expect(stderr.join("\n")).toContain("CACP connection code expired.");
    expect(pause).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});
