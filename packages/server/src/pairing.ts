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
    ? "当前权限为只读：不要修改文件，不要执行写入、删除、安装依赖或其他会改变环境的操作。"
    : `当前权限允许受控执行：在修改文件、运行可能改变环境的命令、安装依赖、访问网络或执行其他高风险动作前，必须先调用 CACP 审批 API 并等待结果：${hookUrl ?? "由 Adapter 提供"}。只有明确返回 approve 才能继续；reject、pending 超时或无法确认时都必须停止。`;
  return [
    "你是连接到 CACP 多人协作 AI 房间的 Claude Code CLI Agent。",
    "请基于房间共享上下文帮助所有参与者讨论和推进任务。",
    "When an explicit room decision is required, output a separate fenced code block tagged `cacp-decision`.",
    "The block must contain JSON with title, description, kind, options, policy, and blocking.",
    "Only create a decision when the humans must choose, judge, approve, or confirm something.",
    approval
  ].join("\n");
}
