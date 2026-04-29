import { describe, expect, it, vi } from "vitest";
import { formatConnectedBanner, printConnectedBanner } from "../src/connected-banner.js";

describe("connected banner", () => {
  it("renders the success message, warning, web-room prompt, diagram, and working dir", () => {
    const banner = formatConnectedBanner({
      roomId: "room_1",
      agentName: "Claude Code Agent",
      workingDir: "D:\\Projects\\my-app",
      claudeSessionMode: "pending-selection",
      color: false
    });

    expect(banner).toContain("CONNECTED SUCCESSFULLY");
    expect(banner).toContain("Do not close this window");
    expect(banner).toContain("The room owner can now return to the CACP Web Room");
    expect(banner).toContain("Start collaborative AI creation");
    expect(banner).toContain("CACP Web Room");
    expect(banner).toContain("Local Agent");
    expect(banner).toContain("Claude Code persistent session");
    expect(banner).toContain("D:\\Projects\\my-app");
    expect(banner).toContain("Claude Code session selection is pending");
    expect(banner).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it("does not show Claude selection pending for LLM API agents", () => {
    const banner = formatConnectedBanner({
      roomId: "room_1",
      agentName: "LLM API Agent",
      workingDir: ".",
      claudeSessionMode: "not-applicable",
      color: false
    });

    expect(banner).toContain("CONNECTED SUCCESSFULLY");
    expect(banner).not.toContain("session selection is pending");
  });

  it("prints the banner through an injectable logger", () => {
    const log = vi.fn();
    printConnectedBanner({
      roomId: "room_1",
      agentName: "Claude Code Agent",
      workingDir: "D:\\Projects\\my-app",
      claudeSessionMode: "pending-selection",
      color: false
    }, log);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("CONNECTED SUCCESSFULLY");
  });
});
