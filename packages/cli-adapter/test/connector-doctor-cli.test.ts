import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const connectorEntry = resolve(process.cwd(), "src/index.ts");

function runDoctor(flag: "--doctor" | "--doctor-json") {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", connectorEntry, flag],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    }
  );
}

describe("Local Connector doctor command", () => {
  it("emits a machine-readable four-Agent compatibility report", () => {
    const result = runDoctor("--doctor-json");
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout) as {
      connector_version: string;
      protocol_version: string;
      node: { version: string; supported: boolean };
      adapters: Array<{
        provider: string;
        sdk_version: string;
        available: boolean;
        resolved_path: string | null;
      }>;
    };

    expect(report).toMatchObject({
      connector_version: "0.5.0",
      protocol_version: "0.3.0",
      node: { supported: true },
    });
    expect(report.adapters.map((adapter) => adapter.provider)).toEqual([
      "claude-code",
      "codex-cli",
      "github-copilot",
      "kimi-cli",
    ]);
    expect(report.adapters.map((adapter) => adapter.sdk_version)).toEqual([
      "0.3.220",
      "0.146.0",
      "1.0.8",
      "0.1.8",
    ]);
    expect(
      report.adapters.every(
        (adapter) =>
          typeof adapter.available === "boolean" &&
          (adapter.resolved_path === null ||
            typeof adapter.resolved_path === "string")
      )
    ).toBe(true);
  });

  it("prints an actionable human-readable diagnostic summary", () => {
    const result = runDoctor("--doctor");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("CACP Local Connector Doctor");
    expect(result.stdout).toContain("Claude Code");
    expect(result.stdout).toContain("Codex CLI");
    expect(result.stdout).toContain("GitHub Copilot");
    expect(result.stdout).toContain("Kimi Code");
    expect(result.stdout).toContain("Attachment input");
  });
});
