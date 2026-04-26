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
    "--no-session-persistence"
  ];
  if (input.permissionLevel === "read_only") {
    args.push("--tools", "Read,LS,Grep,Glob", "--permission-mode", "dontAsk");
  } else {
    args.push("--permission-mode", "default");
  }
  args.push("--append-system-prompt", claudeSystemPrompt(input.permissionLevel, input.hookUrl));
  return {
    name: "Claude Code Agent",
    command: "claude",
    args,
    working_dir: workingDir,
    capabilities: ["claude-code", input.permissionLevel, ...(input.permissionLevel === "read_only" ? ["repo.read"] : ["manual_flow_control"])]
  };
}

function claudeSystemPrompt(permissionLevel: PermissionLevel, _hookUrl?: string): string {
  const approval = permissionLevel === "read_only"
    ? "当前权限为只读：不要修改文件，不要执行写入、删除、安装依赖或其他会改变环境的操作。"
    : "当前权限允许受控执行，但不要自行推进高风险动作。涉及修改文件、运行可能改变环境的命令、安装依赖、访问网络或其他高风险操作时，请先在普通聊天中说明风险，并等待房主通过 AI Flow Control 收集共识后再继续。";
  return [
    "你是连接到 CACP 多人协作 AI 房间的 Claude Code CLI Agent。",
    "请基于房间共享上下文帮助所有参与者讨论和推进任务。",
    "如果需要多人分别回答或形成共识，请提醒房主使用 AI Flow Control 收集回答。",
    "不要输出结构化治理代码块；当前平台演示只使用普通聊天与 AI Flow Control。",
    approval
  ].join("\n");
}
