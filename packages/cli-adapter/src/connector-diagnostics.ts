import type {
  AgentAdapterCompatibility,
  AgentInputCapabilities,
  AgentType,
} from "@cacp/protocol";
import {
  AgentAdapterCompatibilityManifest,
  ConnectorProtocolVersion,
  ConnectorVersion,
} from "./agent-compatibility.js";
import { findClaudeBinary } from "./claude/claude-sdk.js";
import { findCodexBinary } from "./codex/codex-sdk.js";
import { findCopilotCli, findCopilotPackage } from "./copilot/copilot-sdk.js";
import { findKimiCli } from "./kimi/kimi-sdk.js";

export interface ConnectorAdapterDiagnostic {
  provider: AgentType;
  label: string;
  sdk_package: string;
  sdk_version: string;
  available: boolean;
  resolved_path: string | null;
  input_capabilities: AgentInputCapabilities;
  install_hint: string;
}

export interface ConnectorDiagnosticReport {
  connector_version: string;
  protocol_version: string;
  generated_at: string;
  platform: string;
  architecture: string;
  node: {
    version: string;
    supported: boolean;
    requirement: string;
  };
  adapters: ConnectorAdapterDiagnostic[];
  authentication: {
    checked: false;
    note: string;
  };
}

const agentMetadata: Record<
  AgentType,
  {
    label: string;
    findPath: () => string | undefined;
    installHint: string;
  }
> = {
  "claude-code": {
    label: "Claude Code",
    findPath: findClaudeBinary,
    installHint:
      "Install Claude Code: https://docs.anthropic.com/en/docs/claude-code",
  },
  "codex-cli": {
    label: "Codex CLI",
    findPath: findCodexBinary,
    installHint: "Install Codex CLI: https://github.com/openai/codex",
  },
  "github-copilot": {
    label: "GitHub Copilot",
    findPath: () => findCopilotCli() ?? findCopilotPackage(),
    installHint: "Install GitHub Copilot CLI: npm install -g @github/copilot",
  },
  "kimi-cli": {
    label: "Kimi Code",
    findPath: findKimiCli,
    installHint:
      "Install Kimi Code and ensure its CLI is available in PATH: https://www.moonshot.cn/",
  },
};

function nodeIsSupported(version: string): boolean {
  const [major = 0, minor = 0] = version
    .replace(/^v/u, "")
    .split(".")
    .map(Number);
  return major > 22 || (major === 22 && minor >= 12);
}

function adapterDiagnostic(
  compatibility: AgentAdapterCompatibility
): ConnectorAdapterDiagnostic {
  const metadata = agentMetadata[compatibility.provider];
  const resolvedPath = metadata.findPath();
  return {
    provider: compatibility.provider,
    label: metadata.label,
    sdk_package: compatibility.sdk_package,
    sdk_version: compatibility.sdk_version,
    available: Boolean(resolvedPath),
    resolved_path: resolvedPath ?? null,
    input_capabilities: compatibility.input_capabilities,
    install_hint: metadata.installHint,
  };
}

export function collectConnectorDiagnostics(): ConnectorDiagnosticReport {
  return {
    connector_version: ConnectorVersion,
    protocol_version: ConnectorProtocolVersion,
    generated_at: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    node: {
      version: process.versions.node,
      supported: nodeIsSupported(process.versions.node),
      requirement: ">=22.12.0 (24 recommended)",
    },
    adapters: AgentAdapterCompatibilityManifest.map(adapterDiagnostic),
    authentication: {
      checked: false,
      note: "Authentication is verified by the selected Agent when the Connector joins a room.",
    },
  };
}

function attachmentModes(capabilities: AgentInputCapabilities): string {
  return (["image", "pdf", "text", "office", "file"] as const)
    .map((kind) => `${kind}=${capabilities[kind]}`)
    .join(", ");
}

export function formatConnectorDiagnostics(
  report: ConnectorDiagnosticReport
): string {
  const lines = [
    "CACP Local Connector Doctor",
    "===========================",
    `Connector: v${report.connector_version} · protocol ${report.protocol_version}`,
    `Runtime: ${report.node.supported ? "[OK]" : "[UNSUPPORTED]"} Node ${report.node.version} · ${report.platform}/${report.architecture}`,
    `Required: Node ${report.node.requirement}`,
    "",
  ];
  for (const adapter of report.adapters) {
    lines.push(
      `${adapter.available ? "[OK]" : "[MISSING]"} ${adapter.label}`,
      `  SDK: ${adapter.sdk_package}@${adapter.sdk_version}`,
      `  Runtime: ${adapter.resolved_path ?? "not found"}`,
      `  Attachment input: ${attachmentModes(adapter.input_capabilities)}`
    );
    if (!adapter.available) lines.push(`  Action: ${adapter.install_hint}`);
    lines.push("");
  }
  lines.push(
    `Authentication: ${report.authentication.note}`,
    "No tokens, room secrets, or file contents are included in this report."
  );
  return lines.join("\n");
}
