import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compatibilityForProvider,
  ConnectorCompatibilityManifest,
} from "../src/agent-compatibility.js";

describe("local Agent compatibility manifest", () => {
  it("matches every pinned SDK dependency and protocol v0.3", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as { dependencies: Record<string, string> };
    expect(ConnectorCompatibilityManifest.protocol_version).toBe("0.3.0");
    expect(
      ConnectorCompatibilityManifest.adapters.map(
        ({ provider, sdk_package, sdk_version }) => ({
          provider,
          sdk_package,
          sdk_version,
          installed: packageJson.dependencies[sdk_package],
        })
      )
    ).toEqual([
      {
        provider: "claude-code",
        sdk_package: "@anthropic-ai/claude-agent-sdk",
        sdk_version: "0.3.220",
        installed: "0.3.220",
      },
      {
        provider: "codex-cli",
        sdk_package: "@openai/codex-sdk",
        sdk_version: "0.146.0",
        installed: "0.146.0",
      },
      {
        provider: "github-copilot",
        sdk_package: "@github/copilot-sdk",
        sdk_version: "1.0.8",
        installed: "1.0.8",
      },
      {
        provider: "kimi-cli",
        sdk_package: "@moonshot-ai/kimi-agent-sdk",
        sdk_version: "0.1.8",
        installed: "0.1.8",
      },
    ]);
  });

  it("declares an attachment route for every supported kind", () => {
    for (const adapter of ConnectorCompatibilityManifest.adapters) {
      expect(adapter.input_capabilities.max_attachments).toBe(5);
      for (const kind of ["image", "pdf", "text", "office", "file"] as const)
        expect(["native", "file_path"]).toContain(
          adapter.input_capabilities[kind]
        );
    }
  });

  it("resolves each supported provider and rejects unknown providers", () => {
    for (const adapter of ConnectorCompatibilityManifest.adapters) {
      expect(compatibilityForProvider(adapter.provider)).toBe(adapter);
    }
    expect(() => compatibilityForProvider("unsupported" as never)).toThrow(
      "unsupported_agent_provider:unsupported"
    );
  });
});
