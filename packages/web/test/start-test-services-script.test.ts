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
});
