import type {
  AgentAdapterCompatibility,
  AgentType,
  ConnectorCompatibility,
} from "@cacp/protocol";
import { ProtocolVersion } from "@cacp/protocol";

export const ConnectorProtocolVersion = ProtocolVersion;
export const ConnectorVersion = "0.5.0";
export const CodexSdkVersion = "0.146.0";

export const AgentAdapterCompatibilityManifest = [
  {
    provider: "claude-code",
    sdk_package: "@anthropic-ai/claude-agent-sdk",
    sdk_version: "0.3.220",
    input_capabilities: {
      image: "native",
      pdf: "native",
      text: "file_path",
      office: "file_path",
      file: "file_path",
      max_attachments: 5,
    },
  },
  {
    provider: "codex-cli",
    sdk_package: "@openai/codex-sdk",
    sdk_version: CodexSdkVersion,
    input_capabilities: {
      image: "native",
      pdf: "file_path",
      text: "file_path",
      office: "file_path",
      file: "file_path",
      max_attachments: 5,
    },
  },
  {
    provider: "github-copilot",
    sdk_package: "@github/copilot-sdk",
    sdk_version: "1.0.8",
    input_capabilities: {
      image: "native",
      pdf: "native",
      text: "native",
      office: "native",
      file: "native",
      max_attachments: 5,
    },
  },
  {
    provider: "kimi-cli",
    sdk_package: "@moonshot-ai/kimi-agent-sdk",
    sdk_version: "0.1.8",
    input_capabilities: {
      image: "native",
      pdf: "file_path",
      text: "file_path",
      office: "file_path",
      file: "file_path",
      max_attachments: 5,
    },
  },
] as const satisfies readonly AgentAdapterCompatibility[];

export const ConnectorCompatibilityManifest = {
  protocol_version: ConnectorProtocolVersion,
  connector_version: ConnectorVersion,
  adapters: [...AgentAdapterCompatibilityManifest],
} satisfies ConnectorCompatibility;

export function compatibilityForProvider(
  provider: AgentType
): AgentAdapterCompatibility {
  const compatibility = AgentAdapterCompatibilityManifest.find(
    (entry) => entry.provider === provider
  );
  if (!compatibility) {
    throw new Error(`unsupported_agent_provider:${provider}`);
  }
  return compatibility;
}
