import { describe, expect, it } from "vitest";
import { buildAgentProfile } from "../src/pairing.js";

describe("agent pairing profiles", () => {
  it("uses Claude Code CLI permission modes supported by the installed CLI", () => {
    const allowedModes = new Set(["acceptEdits", "auto", "bypassPermissions", "default", "dontAsk", "plan"]);

    for (const permissionLevel of ["read_only", "limited_write", "full_access"] as const) {
      const profile = buildAgentProfile({
        agentType: "claude-code",
        permissionLevel,
        workingDir: "D:\\Development\\2",
        hookUrl: "http://127.0.0.1:3737/rooms/room_1/agent-action-approvals?token=agent_token"
      });
      const mode = profile.args[profile.args.indexOf("--permission-mode") + 1];

      expect(mode, `${permissionLevel} should not generate an invalid Claude permission mode`).not.toBe("ask");
      expect(allowedModes.has(mode)).toBe(true);
    }
  });

  it("maps writable room permissions to distinct Claude Code CLI modes", () => {
    const readOnly = buildAgentProfile({ agentType: "claude-code", permissionLevel: "read_only", workingDir: "D:\\Development\\2" });
    const limitedWrite = buildAgentProfile({ agentType: "claude-code", permissionLevel: "limited_write", workingDir: "D:\\Development\\2" });
    const fullAccess = buildAgentProfile({ agentType: "claude-code", permissionLevel: "full_access", workingDir: "D:\\Development\\2" });

    expect(readOnly.args).toEqual(expect.arrayContaining(["--permission-mode", "dontAsk"]));
    expect(readOnly.args).toEqual(expect.arrayContaining(["--tools", "Read,LS,Grep,Glob"]));
    expect(limitedWrite.args).toEqual(expect.arrayContaining(["--permission-mode", "acceptEdits"]));
    expect(fullAccess.args).toEqual(expect.arrayContaining(["--permission-mode", "bypassPermissions"]));
    expect(fullAccess.args).not.toContain("--tools");
  });

  it("does not impose a Claude Code CLI USD budget cap", () => {
    const profile = buildAgentProfile({
      agentType: "claude-code",
      permissionLevel: "read_only",
      workingDir: "D:\\Development\\2"
    });

    expect(profile.args).not.toContain("--max-budget-usd");
  });

  it("generates a readable Claude Code system prompt that uses AI Flow Control instead of structured decisions", () => {
    const profile = buildAgentProfile({
      agentType: "claude-code",
      permissionLevel: "limited_write",
      workingDir: "D:\\Development\\2",
      hookUrl: "http://127.0.0.1:3737/rooms/room_1/agent-action-approvals?token=agent_token"
    });
    const prompt = profile.args[profile.args.indexOf("--append-system-prompt") + 1];

    expect(prompt).toContain("CACP");
    expect(prompt).toContain("AI Flow Control");
    expect(prompt).not.toContain("cacp-decision");
    expect(prompt).not.toContain("agent-action-approvals");
    expect(prompt).not.toContain("???");
  });

  it("maps Codex CLI approval modes to permission levels", () => {
    const readOnly = buildAgentProfile({ agentType: "codex", permissionLevel: "read_only", workingDir: "D:\\Development\\2" });
    const limitedWrite = buildAgentProfile({ agentType: "codex", permissionLevel: "limited_write", workingDir: "D:\\Development\\2" });
    const fullAccess = buildAgentProfile({ agentType: "codex", permissionLevel: "full_access", workingDir: "D:\\Development\\2" });

    expect(readOnly.args).toEqual(expect.arrayContaining(["--approval-mode", "suggest"]));
    expect(limitedWrite.args).toEqual(expect.arrayContaining(["--approval-mode", "auto-edit"]));
    expect(fullAccess.args).toEqual(expect.arrayContaining(["--approval-mode", "full-auto"]));
  });

  it("generates a Codex CLI system prompt that references CACP and AI Flow Control", () => {
    const profile = buildAgentProfile({
      agentType: "codex",
      permissionLevel: "limited_write",
      workingDir: "D:\\Development\\2"
    });

    expect(profile.system_prompt).toContain("CACP");
    expect(profile.system_prompt).toContain("AI Flow Control");
    expect(profile.system_prompt).toContain("LIMITED WRITE");
  });

  it("produces distinct Codex system prompts for each permission level", () => {
    const readOnly = buildAgentProfile({ agentType: "codex", permissionLevel: "read_only", workingDir: "." });
    const limitedWrite = buildAgentProfile({ agentType: "codex", permissionLevel: "limited_write", workingDir: "." });
    const fullAccess = buildAgentProfile({ agentType: "codex", permissionLevel: "full_access", workingDir: "." });

    expect(readOnly.system_prompt).toContain("READ-ONLY");
    expect(limitedWrite.system_prompt).toContain("LIMITED WRITE");
    expect(fullAccess.system_prompt).toContain("FULL ACCESS");
  });
});
