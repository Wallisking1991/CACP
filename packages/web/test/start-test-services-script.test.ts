import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const scriptPath = resolve(repoRoot, "start-test-services.ps1");
const cmdWrapperPath = resolve(repoRoot, "start-test-services.cmd");

describe("start-test-services.ps1", () => {
  it("provides a root one-click script for local test services", () => {
    expect(existsSync(scriptPath)).toBe(true);
    const script = readFileSync(scriptPath, "utf8");
    const cmd = readFileSync(cmdWrapperPath, "utf8");

    expect(script).toContain("dev:server");
    expect(script).toContain("dev:web");
    expect(script).toContain("3737");
    expect(script).toContain("5173");
    expect(script).toContain("Stop-TestServices");
    expect(script).toContain("[switch]$Foreground");
    expect(script).toContain("Press Ctrl+C or close this window to stop services");
    expect(script).toContain("finally");
    expect(existsSync(cmdWrapperPath)).toBe(true);
    expect(cmd).toContain("-Foreground");
  });

  it("guards the whole foreground lifecycle with cleanup", () => {
    const script = readFileSync(scriptPath, "utf8");
    const lifecycleStart = script.indexOf("function Invoke-ForegroundLifecycle");
    const lifecycleEnd = script.indexOf("if ($Foreground)", lifecycleStart);

    expect(lifecycleStart).toBeGreaterThanOrEqual(0);
    expect(lifecycleEnd).toBeGreaterThan(lifecycleStart);

    const lifecycle = script.slice(lifecycleStart, lifecycleEnd);
    const tryIndex = lifecycle.indexOf("try {");
    const waitIndex = lifecycle.indexOf("Wait-Until");
    const openIndex = lifecycle.indexOf("Start-Process $WebUrl");
    const tailIndex = lifecycle.indexOf("Get-Content");
    const finallyIndex = lifecycle.indexOf("finally {");
    const stopIndex = lifecycle.indexOf("Stop-TestServices", finallyIndex);

    expect(tryIndex).toBeGreaterThanOrEqual(0);
    expect(waitIndex).toBeGreaterThan(tryIndex);
    expect(openIndex).toBeGreaterThan(waitIndex);
    expect(tailIndex).toBeGreaterThan(openIndex);
    expect(finallyIndex).toBeGreaterThan(tailIndex);
    expect(stopIndex).toBeGreaterThan(finallyIndex);
  });
});
