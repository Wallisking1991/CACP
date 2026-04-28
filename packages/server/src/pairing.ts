export const CommandAgentTypeValues = ["claude-code", "codex", "opencode", "echo"] as const;
export const LlmAgentTypeValues = ["llm-openai-compatible", "llm-anthropic-compatible"] as const;
export const AgentTypeValues = [...CommandAgentTypeValues, ...LlmAgentTypeValues] as const;
export type AgentType = typeof AgentTypeValues[number];
export type LlmAgentType = typeof LlmAgentTypeValues[number];

export function isLlmAgentType(agentType: string): agentType is LlmAgentType {
  return (LlmAgentTypeValues as readonly string[]).includes(agentType);
}

export const PermissionLevelValues = ["read_only", "limited_write", "full_access"] as const;
export type PermissionLevel = typeof PermissionLevelValues[number];

export interface AgentPairingProfile {
  name: string;
  command: string;
  args: string[];
  working_dir: string;
  capabilities: string[];
  system_prompt?: string;
}

export function buildAgentProfile(input: { agentType: AgentType; permissionLevel: PermissionLevel; workingDir?: string; hookUrl?: string }): AgentPairingProfile {
  const workingDir = input.workingDir || ".";
  if (input.agentType === "llm-openai-compatible") {
    return { name: "OpenAI-compatible LLM API Agent", command: "", args: [], working_dir: workingDir, capabilities: ["llm.api", "chat.stream", "llm.openai_compatible"], system_prompt: llmApiSystemPrompt() };
  }
  if (input.agentType === "llm-anthropic-compatible") {
    return { name: "Anthropic-compatible LLM API Agent", command: "", args: [], working_dir: workingDir, capabilities: ["llm.api", "chat.stream", "llm.anthropic_compatible"], system_prompt: llmApiSystemPrompt() };
  }
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
    const codexApprovalMode = input.permissionLevel === "read_only" ? "suggest" : input.permissionLevel === "limited_write" ? "auto-edit" : "full-auto";
    return {
      name: "Codex CLI Agent",
      command: "codex",
      args: ["exec", "-", "--approval-mode", codexApprovalMode],
      working_dir: workingDir,
      capabilities: ["codex", input.permissionLevel],
      system_prompt: codexSystemPrompt(input.permissionLevel)
    };
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
  } else if (input.permissionLevel === "limited_write") {
    args.push("--permission-mode", "acceptEdits");
  } else {
    args.push("--permission-mode", "bypassPermissions");
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
    : permissionLevel === "limited_write"
      ? "当前权限允许普通文件创建和编辑。对于删除文件、批量重构、安装依赖、访问网络或运行可能改变环境的命令，请先说明风险并等待房主确认。"
      : "当前权限为 Full access：当房主明确要求时，可以创建/修改文件并执行必要命令。对于破坏性、不可逆或大范围操作，仍需先说明风险并等待房主确认。";
  return [
    "你是连接到 CACP 多人协作 AI 房间的 Claude Code CLI Agent。",
    "请基于房间共享上下文帮助所有参与者讨论和推进任务。",
    "如果需要多人分别回答或形成共识，请提醒房主使用 Roundtable Mode 收集回答。",
    "不要输出结构化治理代码块；当前平台演示只使用普通聊天与 Roundtable Mode。",
    approval
  ].join("\n");
}

function llmApiSystemPrompt(): string {
  return [
    "You are an LLM API Agent connected to a CACP multi-user AI room.",
    "You are a pure conversation agent. Do not claim to read files, modify files, run local commands, call tools, or access private systems.",
    "If multiple participants need to answer separately or reach consensus, remind the room owner to use Roundtable Mode.",
    "Reply in concise, actionable Chinese by default unless the room context asks for another language."
  ].join("\n");
}

function codexSystemPrompt(permissionLevel: PermissionLevel): string {
  const approval = permissionLevel === "read_only"
    ? "You are in READ-ONLY mode. Do NOT modify files, do NOT write, delete, install dependencies, or execute any commands that change the environment. Only read and analyze code."
    : permissionLevel === "limited_write"
      ? "You have LIMITED WRITE permissions. You may create and edit files, but for destructive operations (deleting files, bulk refactoring, installing dependencies, network access, or commands that may alter the environment), you MUST first explain the risks and wait for owner confirmation."
      : "You have FULL ACCESS permissions. You may create/modify files and execute necessary commands when explicitly requested by the room owner. For destructive, irreversible, or large-scale operations, you MUST still explain the risks and wait for owner confirmation.";
  return [
    "You are a Codex CLI Agent connected to a CACP (Collaborative Agent Communication Protocol) multi-user AI room.",
    "Help all participants discuss and advance tasks based on the shared room context.",
    "If multiple participants need to answer separately or reach consensus, remind the room owner to use Roundtable Mode to collect responses.",
    "Do not output structured governance blocks; the current platform demo uses only normal chat and Roundtable Mode.",
    approval
  ].join("\n");
}
