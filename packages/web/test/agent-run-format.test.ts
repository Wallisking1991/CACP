import { describe, expect, it } from "vitest";
import { providerLabel } from "../src/components/agent-run-format.js";

describe("providerLabel", () => {
  it("returns Claude Code for claude-code", () => {
    expect(providerLabel("claude-code")).toBe("Claude Code");
  });

  it("returns Codex CLI for codex-cli", () => {
    expect(providerLabel("codex-cli")).toBe("Codex CLI");
  });

  it("returns GitHub Copilot for github-copilot", () => {
    expect(providerLabel("github-copilot")).toBe("GitHub Copilot");
  });

  it("returns Local agent for unknown provider", () => {
    expect(providerLabel("unknown")).toBe("Local agent");
  });
});
