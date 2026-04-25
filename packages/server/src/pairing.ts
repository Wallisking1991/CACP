export const AgentTypeValues = ["claude-code", "codex", "opencode", "echo"] as const;
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

export function buildAgentProfile(input: { agentType: AgentType; permissionLevel: PermissionLevel; workingDir?: string; hookUrl?: string }): AgentPairingProfile {
  const workingDir = input.workingDir || ".";
  if (input.agentType === "echo") {
    return {
      name: "Echo Test Agent",
      command: "node",
      args: ["-e", "process.stdin.on('data', d => process.stdout.write('agent:' + d.toString()))"],
      working_dir: workingDir,
      capabilities: ["echo", input.permissionLevel]
    };
  }
  if (input.agentType === "codex") {
    return { name: "Codex CLI Agent", command: "codex", args: ["exec", "-"], working_dir: workingDir, capabilities: ["codex", input.permissionLevel] };
  }
  if (input.agentType === "opencode") {
    return { name: "opencode CLI Agent", command: "opencode", args: ["run", "-"], working_dir: workingDir, capabilities: ["opencode", input.permissionLevel] };
  }
  const args = [
    "-p",
    "--output-format",
    "text",
    "--no-session-persistence",
    "--max-budget-usd",
    "0.10"
  ];
  if (input.permissionLevel === "read_only") {
    args.push("--tools", "Read,LS,Grep,Glob", "--permission-mode", "dontAsk");
  } else {
    args.push("--permission-mode", "ask");
  }
  args.push("--append-system-prompt", claudeSystemPrompt(input.permissionLevel, input.hookUrl));
  return {
    name: "Claude Code Agent",
    command: "claude",
    args,
    working_dir: workingDir,
    capabilities: ["claude-code", input.permissionLevel, ...(input.permissionLevel === "read_only" ? ["repo.read"] : ["tool.approval"])]
  };
}

function claudeSystemPrompt(permissionLevel: PermissionLevel, hookUrl?: string): string {
  const approval = permissionLevel === "read_only"
    ? "???????????????????????????????"
    : `???????????????????????????????????????????? CACP ??????? API: ${hookUrl ?? "? Adapter ??"}`;
  return `???? CACP ????????? Claude Code CLI Agent?????????????????${approval}`;
}
