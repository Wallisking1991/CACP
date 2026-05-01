export type LocalAgentProvider = "claude-code" | "codex-cli";

export function providerForCapabilities(capabilities: string[]): LocalAgentProvider | undefined {
  if (capabilities.includes("claude-code")) return "claude-code";
  if (capabilities.includes("codex-cli")) return "codex-cli";
  return undefined;
}

export function providerDisplayName(provider: LocalAgentProvider): string {
  return provider === "codex-cli" ? "Codex CLI" : "Claude Code";
}

export function localAgentCapabilityForProvider(provider: LocalAgentProvider): string {
  return provider;
}
