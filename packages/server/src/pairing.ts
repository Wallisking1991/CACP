export const CommandAgentTypeValues = ["claude-code", "codex-cli", "github-copilot", "kimi-cli"] as const;
export const AgentTypeValues = [...CommandAgentTypeValues] as const;
export type AgentType = typeof AgentTypeValues[number];

export const PermissionLevelValues = ["read_only", "limited_write", "full_access"] as const;
export type PermissionLevel = typeof PermissionLevelValues[number];

export interface AgentPairingProfile {
  name: string;
  command: string;
  args: string[];
  working_dir: string;
  capabilities: string[];
}

export function buildAgentProfile(input: { agentType: AgentType; permissionLevel: PermissionLevel; workingDir?: string }): AgentPairingProfile {
  const workingDir = input.workingDir || ".";

  if (input.agentType === "github-copilot") {
    return {
      name: "GitHub Copilot Agent",
      command: "gh",
      args: [],
      working_dir: workingDir,
      capabilities: [
        "github-copilot",
        "copilot.persistent_session",
        input.permissionLevel,
        ...(input.permissionLevel === "read_only" ? ["repo.read"] : ["manual_flow_control"])
      ]
    };
  }

  if (input.agentType === "codex-cli") {
    return {
      name: "Codex CLI Agent",
      command: "codex",
      args: [],
      working_dir: workingDir,
      capabilities: [
        "codex-cli",
        "code-agent.persistent_session",
        "code-agent.local_execution",
        input.permissionLevel,
        ...(input.permissionLevel === "read_only" ? ["repo.read"] : ["manual_flow_control"])
      ]
    };
  }

  if (input.agentType === "kimi-cli") {
    return {
      name: "Kimi CLI Agent",
      command: "kimi",
      args: [],
      working_dir: workingDir,
      capabilities: [
        "kimi-cli",
        "kimi.persistent_session",
        input.permissionLevel,
        ...(input.permissionLevel === "read_only" ? ["repo.read"] : ["manual_flow_control"])
      ]
    };
  }

  return {
    name: "Claude Code Agent",
    command: "claude",
    args: [],
    working_dir: workingDir,
    capabilities: [
      "claude-code",
      "claude.persistent_session",
      input.permissionLevel,
      ...(input.permissionLevel === "read_only" ? ["repo.read"] : ["manual_flow_control"])
    ]
  };
}
