import type { LocalAgentProvider } from "@cacp/protocol";

export { type LocalAgentProvider };

export function providerForCapabilities(capabilities: string[]): LocalAgentProvider | undefined {
  if (capabilities.includes("claude-code")) return "claude-code";
  if (capabilities.includes("github-copilot")) return "github-copilot";
  if (capabilities.includes("codex-cli")) return "codex-cli";
  if (capabilities.includes("kimi-cli")) return "kimi-cli";
  return undefined;
}

export function providerDisplayName(provider: LocalAgentProvider): string {
  if (provider === "codex-cli") return "Codex CLI";
  if (provider === "github-copilot") return "GitHub Copilot";
  if (provider === "kimi-cli") return "Kimi CLI";
  return "Claude Code";
}

export function localAgentCapabilityForProvider(provider: LocalAgentProvider): string {
  return provider;
}
