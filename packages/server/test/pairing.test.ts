import { describe, expect, it } from "vitest";
import { AgentTypeValues, buildAgentProfile } from "../src/pairing.js";

describe("agent pairing profiles", () => {
  it("only supports CLI agent types", () => {
    expect(AgentTypeValues).toEqual([
      "claude-code",
      "codex-cli",
      "github-copilot",
      "kimi-cli"
    ]);
  });

  it("does not include LLM API agent types", () => {
    expect(AgentTypeValues).not.toContain("llm-api");
    expect(AgentTypeValues).not.toContain("llm-openai-compatible");
    expect(AgentTypeValues).not.toContain("llm-anthropic-compatible");
  });

  it("builds a Claude Code persistent-session profile without system_prompt", () => {
    const profile = buildAgentProfile({
      agentType: "claude-code",
      permissionLevel: "limited_write",
      workingDir: "D:\\Development\\2"
    });

    expect(profile.name).toBe("Claude Code Agent");
    expect(profile.command).toBe("claude");
    expect(profile.args).toEqual([]);
    expect(profile.capabilities).toEqual([
      "claude-code",
      "claude.persistent_session",
      "limited_write",
      "manual_flow_control"
    ]);
    expect(profile).not.toHaveProperty("system_prompt");
  });

  it("does not configure Claude Code with print mode or disabled session persistence", () => {
    const profile = buildAgentProfile({
      agentType: "claude-code",
      permissionLevel: "read_only",
      workingDir: "D:\\Development\\2"
    });

    expect(profile.args).not.toContain("-p");
    expect(profile.args).not.toContain("--print");
    expect(profile.args).not.toContain("--output-format");
    expect(profile.args).not.toContain("--no-session-persistence");
  });

  it("keeps permission intent in Claude profile capabilities", () => {
    const readOnly = buildAgentProfile({ agentType: "claude-code", permissionLevel: "read_only", workingDir: "." });
    const limitedWrite = buildAgentProfile({ agentType: "claude-code", permissionLevel: "limited_write", workingDir: "." });
    const fullAccess = buildAgentProfile({ agentType: "claude-code", permissionLevel: "full_access", workingDir: "." });

    expect(readOnly.capabilities).toContain("read_only");
    expect(readOnly.capabilities).toContain("repo.read");
    expect(limitedWrite.capabilities).toContain("limited_write");
    expect(limitedWrite.capabilities).toContain("manual_flow_control");
    expect(fullAccess.capabilities).toContain("full_access");
    expect(fullAccess.capabilities).toContain("manual_flow_control");
  });

  it("builds a Codex CLI local execution profile without system_prompt", () => {
    const profile = buildAgentProfile({
      agentType: "codex-cli",
      permissionLevel: "limited_write",
      workingDir: "D:\\Development\\2"
    });

    expect(profile.name).toBe("Codex CLI Agent");
    expect(profile.command).toBe("codex");
    expect(profile.args).toEqual([]);
    expect(profile.working_dir).toBe("D:\\Development\\2");
    expect(profile.capabilities).toEqual([
      "codex-cli",
      "code-agent.persistent_session",
      "code-agent.local_execution",
      "limited_write",
      "manual_flow_control"
    ]);
    expect(profile).not.toHaveProperty("system_prompt");
  });

  it("builds a GitHub Copilot CLI profile without system_prompt", () => {
    const profile = buildAgentProfile({
      agentType: "github-copilot",
      permissionLevel: "limited_write",
      workingDir: "D:\\Development\\2"
    });

    expect(profile.name).toBe("GitHub Copilot Agent");
    expect(profile.command).toBe("gh");
    expect(profile.args).toEqual([]);
    expect(profile.working_dir).toBe("D:\\Development\\2");
    expect(profile.capabilities).toEqual([
      "github-copilot",
      "copilot.persistent_session",
      "limited_write",
      "manual_flow_control"
    ]);
    expect(profile).not.toHaveProperty("system_prompt");
  });

  it("builds a Kimi CLI profile without system_prompt", () => {
    const profile = buildAgentProfile({
      agentType: "kimi-cli",
      permissionLevel: "limited_write",
      workingDir: "D:\\Development\\2"
    });

    expect(profile.name).toBe("Kimi CLI Agent");
    expect(profile.command).toBe("kimi");
    expect(profile.args).toEqual([]);
    expect(profile.working_dir).toBe("D:\\Development\\2");
    expect(profile.capabilities).toEqual([
      "kimi-cli",
      "kimi.persistent_session",
      "limited_write",
      "manual_flow_control"
    ]);
    expect(profile).not.toHaveProperty("system_prompt");
  });

  it("keeps permission intent in Kimi CLI profile capabilities", () => {
    const readOnly = buildAgentProfile({ agentType: "kimi-cli", permissionLevel: "read_only", workingDir: "." });
    const limitedWrite = buildAgentProfile({ agentType: "kimi-cli", permissionLevel: "limited_write", workingDir: "." });
    const fullAccess = buildAgentProfile({ agentType: "kimi-cli", permissionLevel: "full_access", workingDir: "." });

    expect(readOnly.capabilities).toContain("read_only");
    expect(readOnly.capabilities).toContain("repo.read");
    expect(limitedWrite.capabilities).toContain("limited_write");
    expect(limitedWrite.capabilities).toContain("manual_flow_control");
    expect(fullAccess.capabilities).toContain("full_access");
    expect(fullAccess.capabilities).toContain("manual_flow_control");
  });

  it("enables thinking mode for Kimi CLI profiles", () => {
    const profile = buildAgentProfile({ agentType: "kimi-cli", permissionLevel: "limited_write", workingDir: "." });
    expect(profile.thinking).toBe(true);
  });

  it("does not enable thinking mode for non-Kimi CLI agent types", () => {
    const claude = buildAgentProfile({ agentType: "claude-code", permissionLevel: "full_access", workingDir: "." });
    const codex = buildAgentProfile({ agentType: "codex-cli", permissionLevel: "full_access", workingDir: "." });
    const copilot = buildAgentProfile({ agentType: "github-copilot", permissionLevel: "full_access", workingDir: "." });

    expect(claude).not.toHaveProperty("thinking");
    expect(codex).not.toHaveProperty("thinking");
    expect(copilot).not.toHaveProperty("thinking");
  });

  it("keeps permission intent in GitHub Copilot profile capabilities", () => {
    const readOnly = buildAgentProfile({ agentType: "github-copilot", permissionLevel: "read_only", workingDir: "." });
    const limitedWrite = buildAgentProfile({ agentType: "github-copilot", permissionLevel: "limited_write", workingDir: "." });
    const fullAccess = buildAgentProfile({ agentType: "github-copilot", permissionLevel: "full_access", workingDir: "." });

    expect(readOnly.capabilities).toContain("read_only");
    expect(readOnly.capabilities).toContain("repo.read");
    expect(limitedWrite.capabilities).toContain("limited_write");
    expect(limitedWrite.capabilities).toContain("manual_flow_control");
    expect(fullAccess.capabilities).toContain("full_access");
    expect(fullAccess.capabilities).toContain("manual_flow_control");
  });
});
