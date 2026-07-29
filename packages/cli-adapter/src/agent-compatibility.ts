import type {
  AgentAdapterCompatibility,
  AgentType,
  ConnectorCompatibility,
} from "@cacp/protocol";
import {
  ProtocolVersion,
  RequiredAgentAdapterCompatibility,
} from "@cacp/protocol";

export const ConnectorProtocolVersion = ProtocolVersion;
export const ConnectorVersion = "0.5.0";
export const AgentAdapterCompatibilityManifest =
  RequiredAgentAdapterCompatibility;
export const CodexSdkVersion = AgentAdapterCompatibilityManifest.find(
  (entry) => entry.provider === "codex-cli"
)!.sdk_version;

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
