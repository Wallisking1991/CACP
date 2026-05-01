import { describe, expect, it } from "vitest";
import { AgentTypeValues, buildAgentProfile, isLlmAgentType } from "../src/pairing.js";

describe("agent pairing profiles", () => {
  it("supports Claude Code and Codex CLI as local command agents while keeping LLM API agents", () => {
    expect(AgentTypeValues).toEqual([
      "claude-code",
      "codex-cli",
      "llm-api",
      "llm-openai-compatible",
      "llm-anthropic-compatible"
    ]);
    expect(isLlmAgentType("llm-api")).toBe(true);
    expect(isLlmAgentType("llm-openai-compatible")).toBe(true);
    expect(isLlmAgentType("llm-anthropic-compatible")).toBe(true);
    expect(isLlmAgentType("claude-code")).toBe(false);
    expect(isLlmAgentType("codex-cli")).toBe(false);
    expect((AgentTypeValues as readonly string[]).includes("codex")).toBe(false);
    expect((AgentTypeValues as readonly string[]).includes("opencode")).toBe(false);
    expect((AgentTypeValues as readonly string[]).includes("echo")).toBe(false);
  });

  it("builds a Claude Code persistent-session profile instead of a per-turn print command", () => {
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
    expect(profile.system_prompt).toContain("CACP");
    expect(profile.system_prompt).toContain("Roundtable Mode");
    expect(profile.system_prompt).not.toContain("???");
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

  it("builds a Codex CLI local execution profile", () => {
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
    expect(profile.system_prompt).toContain("Codex CLI Agent");
    expect(profile.system_prompt).toContain("CACP");
  });

  it("declares LLM API agent types", () => {
    expect(AgentTypeValues).toContain("llm-api");
    expect(AgentTypeValues).toContain("llm-openai-compatible");
    expect(AgentTypeValues).toContain("llm-anthropic-compatible");
    expect(isLlmAgentType("llm-api")).toBe(true);
    expect(isLlmAgentType("llm-openai-compatible")).toBe(true);
    expect(isLlmAgentType("llm-anthropic-compatible")).toBe(true);
    expect(isLlmAgentType("codex")).toBe(false);
    expect(isLlmAgentType("codex-cli")).toBe(false);
  });

  it("builds pure conversation profiles for LLM API agents", () => {
    const openai = buildAgentProfile({ agentType: "llm-openai-compatible", permissionLevel: "read_only", workingDir: "." });
    const anthropic = buildAgentProfile({ agentType: "llm-anthropic-compatible", permissionLevel: "full_access", workingDir: "." });
    const llmApi = buildAgentProfile({ agentType: "llm-api", permissionLevel: "full_access", workingDir: "." });

    expect(openai.command).toBe("");
    expect(openai.args).toEqual([]);
    expect(openai.capabilities).toEqual(["llm.api", "chat.stream", "llm.openai_compatible"]);
    expect(openai.capabilities).not.toContain("read_only");
    expect(anthropic.command).toBe("");
    expect(anthropic.args).toEqual([]);
    expect(anthropic.capabilities).toEqual(["llm.api", "chat.stream", "llm.anthropic_compatible"]);
    expect(anthropic.capabilities).not.toContain("full_access");
    expect(llmApi.command).toBe("");
    expect(llmApi.args).toEqual([]);
    expect(llmApi.capabilities).toEqual(["llm.api", "chat.stream"]);
    expect(llmApi.capabilities).not.toContain("full_access");
  });
});
