import { describe, expect, it } from "vitest";
import { providerForCapabilities, providerDisplayName, localAgentCapabilityForProvider } from "../src/local-agent-events.js";

describe("providerForCapabilities", () => {
  it("returns claude-code when capabilities include claude-code", () => {
    expect(providerForCapabilities(["claude-code", "chat.stream"])).toBe("claude-code");
  });

  it("returns codex-cli when capabilities include codex-cli", () => {
    expect(providerForCapabilities(["codex-cli", "code-agent.local_execution"])).toBe("codex-cli");
  });

  it("returns github-copilot when capabilities include github-copilot", () => {
    expect(providerForCapabilities(["github-copilot", "copilot.cli"])).toBe("github-copilot");
  });

  it("returns kimi-cli when capabilities include kimi-cli", () => {
    expect(providerForCapabilities(["kimi-cli", "kimi.persistent_session"])).toBe("kimi-cli");
  });

  it("prefers claude-code over codex-cli when both are present", () => {
    expect(providerForCapabilities(["codex-cli", "claude-code"])).toBe("claude-code");
  });

  it("prefers claude-code over kimi-cli when both are present", () => {
    expect(providerForCapabilities(["kimi-cli", "claude-code"])).toBe("claude-code");
  });

  it("returns undefined for unknown capabilities", () => {
    expect(providerForCapabilities(["llm.api", "chat.stream"])).toBeUndefined();
  });
});

describe("providerDisplayName", () => {
  it("returns Claude Code for claude-code", () => {
    expect(providerDisplayName("claude-code")).toBe("Claude Code");
  });

  it("returns Codex CLI for codex-cli", () => {
    expect(providerDisplayName("codex-cli")).toBe("Codex CLI");
  });

  it("returns GitHub Copilot for github-copilot", () => {
    expect(providerDisplayName("github-copilot")).toBe("GitHub Copilot");
  });

  it("returns Kimi CLI for kimi-cli", () => {
    expect(providerDisplayName("kimi-cli")).toBe("Kimi CLI");
  });
});

describe("localAgentCapabilityForProvider", () => {
  it("returns the provider as the capability name", () => {
    expect(localAgentCapabilityForProvider("claude-code")).toBe("claude-code");
    expect(localAgentCapabilityForProvider("codex-cli")).toBe("codex-cli");
    expect(localAgentCapabilityForProvider("github-copilot")).toBe("github-copilot");
    expect(localAgentCapabilityForProvider("kimi-cli")).toBe("kimi-cli");
  });
});
