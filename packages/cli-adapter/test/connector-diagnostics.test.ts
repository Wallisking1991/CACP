import { describe, expect, it } from "vitest";
import {
  collectConnectorDiagnostics,
  formatConnectorDiagnostics,
  type ConnectorDiagnosticReport,
} from "../src/connector-diagnostics.js";

describe("Connector diagnostic report", () => {
  it("collects all supported adapters with their exact compatibility contract", () => {
    const report = collectConnectorDiagnostics();

    expect(report.connector_version).toBe("0.5.0");
    expect(report.protocol_version).toBe("0.3.0");
    expect(report.node).toMatchObject({
      version: process.versions.node,
      supported: true,
      requirement: ">=22.12.0 (24 recommended)",
    });
    expect(report.adapters).toHaveLength(4);
    expect(
      report.adapters.map(
        ({ provider, sdk_package, sdk_version, input_capabilities }) => ({
          provider,
          sdk_package,
          sdk_version,
          image: input_capabilities.image,
          pdf: input_capabilities.pdf,
        })
      )
    ).toEqual([
      {
        provider: "claude-code",
        sdk_package: "@anthropic-ai/claude-agent-sdk",
        sdk_version: "0.3.220",
        image: "native",
        pdf: "native",
      },
      {
        provider: "codex-cli",
        sdk_package: "@openai/codex-sdk",
        sdk_version: "0.146.0",
        image: "native",
        pdf: "file_path",
      },
      {
        provider: "github-copilot",
        sdk_package: "@github/copilot-sdk",
        sdk_version: "1.0.8",
        image: "native",
        pdf: "native",
      },
      {
        provider: "kimi-cli",
        sdk_package: "@moonshot-ai/kimi-agent-sdk",
        sdk_version: "0.1.8",
        image: "native",
        pdf: "file_path",
      },
    ]);
  });

  it("formats available and missing runtimes with actionable attachment details", () => {
    const report: ConnectorDiagnosticReport = {
      connector_version: "0.5.0",
      protocol_version: "0.3.0",
      generated_at: "2026-07-30T00:00:00.000Z",
      platform: "win32",
      architecture: "x64",
      node: {
        version: "24.0.0",
        supported: true,
        requirement: ">=22.12.0 (24 recommended)",
      },
      adapters: [
        {
          provider: "claude-code",
          label: "Claude Code",
          sdk_package: "@anthropic-ai/claude-agent-sdk",
          sdk_version: "0.3.220",
          available: true,
          resolved_path: "C:\\Tools\\claude.exe",
          input_capabilities: {
            image: "native",
            pdf: "native",
            text: "file_path",
            office: "file_path",
            file: "file_path",
            max_attachments: 5,
          },
          install_hint: "Install Claude Code",
        },
        {
          provider: "codex-cli",
          label: "Codex CLI",
          sdk_package: "@openai/codex-sdk",
          sdk_version: "0.146.0",
          available: false,
          resolved_path: null,
          input_capabilities: {
            image: "native",
            pdf: "file_path",
            text: "file_path",
            office: "file_path",
            file: "file_path",
            max_attachments: 5,
          },
          install_hint: "Install Codex CLI",
        },
      ],
      authentication: {
        checked: false,
        note: "Authentication is checked during room connection.",
      },
    };

    const formatted = formatConnectorDiagnostics(report);
    expect(formatted).toContain("[OK] Claude Code");
    expect(formatted).toContain("C:\\Tools\\claude.exe");
    expect(formatted).toContain("[MISSING] Codex CLI");
    expect(formatted).toContain("Action: Install Codex CLI");
    expect(formatted).toContain(
      "Attachment input: image=native, pdf=native, text=file_path"
    );
    expect(formatted).toContain(
      "No tokens, room secrets, or file contents are included"
    );
  });
});
