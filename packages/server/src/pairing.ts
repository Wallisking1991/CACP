export const CommandAgentTypeValues = ["claude-code"] as const;
export const LlmAgentTypeValues = ["llm-api", "llm-openai-compatible", "llm-anthropic-compatible"] as const;
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
  if (input.agentType === "llm-api") {
    return { name: "LLM API Agent", command: "", args: [], working_dir: workingDir, capabilities: ["llm.api", "chat.stream"], system_prompt: llmApiSystemPrompt() };
  }
  if (input.agentType === "llm-openai-compatible") {
    return { name: "OpenAI-compatible LLM API Agent", command: "", args: [], working_dir: workingDir, capabilities: ["llm.api", "chat.stream", "llm.openai_compatible"], system_prompt: llmApiSystemPrompt() };
  }
  if (input.agentType === "llm-anthropic-compatible") {
    return { name: "Anthropic-compatible LLM API Agent", command: "", args: [], working_dir: workingDir, capabilities: ["llm.api", "chat.stream", "llm.anthropic_compatible"], system_prompt: llmApiSystemPrompt() };
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
    ],
    system_prompt: claudeSystemPrompt(input.permissionLevel, input.hookUrl)
  };
}

function claudeSystemPrompt(permissionLevel: PermissionLevel, _hookUrl?: string): string {
  const approval = permissionLevel === "read_only"
    ? "当前权限为只读：不要修改文件，不要执行写入、删除、安装依赖或其他会改变环境的操作。"
    : permissionLevel === "limited_write"
      ? "当前权限允许普通文件创建和编辑。对于删除文件、批量重构、安装依赖、访问网络或运行可能改变环境的命令，请先说明风险并等待房主确认。"
      : "当前权限为 Full access：当房主明确要求时，可以创建/修改文件并执行必要命令。对于破坏性、不可逆或大范围操作，仍需先说明风险并等待房主确认。";
  return [
    "你是连接到 CACP 多人协作 AI 房间的 Claude Code Agent。",
    "你运行在房主本地项目目录中的一个持久 Claude Code 会话里。",
    "请基于 Claude Code 自身会话上下文、项目上下文和房间新增消息帮助所有参与者推进任务。",
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
