import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCodexSdkFromModule, findCodexBinary } from "../src/codex/codex-sdk.js";
import { toCodexThreadOptions } from "../src/codex/types.js";

describe("Codex SDK boundary", () => {
  it("creates Codex with an explicit executable override", () => {
    const constructorOptions: unknown[] = [];
    class FakeCodex {
      constructor(options: unknown) {
        constructorOptions.push(options);
      }
      startThread() {
        return { id: null, runStreamed: async function runStreamed() { return { events: async function* () {}() }; } };
      }
      resumeThread() {
        return { id: "session_1", runStreamed: async function runStreamed() { return { events: async function* () {}() }; } };
      }
    }

    const sdk = createCodexSdkFromModule({ Codex: FakeCodex }, { codexPath: "codex-test" });
    expect(sdk.startThread({ workingDirectory: "D:\\Development\\2" }).id).toBeNull();
    expect(constructorOptions[0]).toMatchObject({ codexPathOverride: "codex-test" });
  });

  it("does not force a bare codex executable override when no path is configured", () => {
    const original = process.env.CACP_CODEX_PATH;
    delete process.env.CACP_CODEX_PATH;
    const constructorOptions: unknown[] = [];
    class FakeCodex {
      constructor(options: unknown) {
        constructorOptions.push(options);
      }
      startThread() {
        return { id: null, runStreamed: async function runStreamed() { return { events: async function* () {}() }; } };
      }
      resumeThread() {
        return { id: "session_1", runStreamed: async function runStreamed() { return { events: async function* () {}() }; } };
      }
    }

    try {
      const sdk = createCodexSdkFromModule({ Codex: FakeCodex });
      expect(sdk.startThread({ workingDirectory: "D:\\Development\\2" }).id).toBeNull();
      expect(constructorOptions[0]).toEqual({});
    } finally {
      if (original === undefined) {
        delete process.env.CACP_CODEX_PATH;
      } else {
        process.env.CACP_CODEX_PATH = original;
      }
    }
  });

  it("maps CACP permission levels to Codex thread options", () => {
    expect(toCodexThreadOptions({ workingDir: "D:\\Development\\2", permissionLevel: "read_only" })).toMatchObject({
      workingDirectory: "D:\\Development\\2",
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false
    });
    expect(toCodexThreadOptions({ workingDir: "D:\\Development\\2", permissionLevel: "limited_write" })).toMatchObject({
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: false
    });
    expect(toCodexThreadOptions({ workingDir: "D:\\Development\\2", permissionLevel: "full_access" })).toMatchObject({
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
      networkAccessEnabled: true
    });
  });

  it("finds the Codex binary in a pnpm virtual store layout", () => {
    const tmp = mkdtempSync(join(tmpdir(), "codex-test-"));
    const originalCwd = process.cwd();
    try {
      process.chdir(tmp);
      const triple = process.platform === "win32" ? "x86_64-pc-windows-msvc" : "x86_64-unknown-linux-musl";
      const binName = process.platform === "win32" ? "codex.exe" : "codex";
      const binDir = join(tmp, "node_modules", ".pnpm", "@openai+codex@0.128.0-win32-x64", "node_modules", "@openai", "codex", "vendor", triple, "codex");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(join(binDir, binName), "fake-binary", { mode: 0o755 });

      const result = findCodexBinary();
      expect(result).toBe(join(binDir, binName));
    } finally {
      process.chdir(originalCwd);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("finds the Codex binary in a standard npm local install", () => {
    const tmp = mkdtempSync(join(tmpdir(), "codex-test-"));
    const originalCwd = process.cwd();
    try {
      process.chdir(tmp);
      const triple = process.platform === "win32" ? "x86_64-pc-windows-msvc" : "x86_64-unknown-linux-musl";
      const binName = process.platform === "win32" ? "codex.exe" : "codex";
      const binDir = join(tmp, "node_modules", "@openai", "codex", "vendor", triple, "codex");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(join(binDir, binName), "fake-binary", { mode: 0o755 });

      const result = findCodexBinary();
      expect(result).toBe(join(binDir, binName));
    } finally {
      process.chdir(originalCwd);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("finds the Codex binary in an npm global install with nested optional package layout", () => {
    const tmp = mkdtempSync(join(tmpdir(), "codex-test-global-"));
    const originalCwd = process.cwd();
    const originalPath = process.env.PATH;
    const originalAppData = process.env.APPDATA;
    const originalLocalAppData = process.env.LOCALAPPDATA;
    try {
      process.chdir(tmp);
      process.env.PATH = tmp;
      process.env.APPDATA = join(tmp, "Roaming");
      process.env.LOCALAPPDATA = join(tmp, "Local");
      const triple = process.platform === "win32" ? "x86_64-pc-windows-msvc" : "x86_64-unknown-linux-musl";
      const platformPackage = process.platform === "win32" ? "codex-win32-x64" : "codex-linux-x64";
      const binName = process.platform === "win32" ? "codex.exe" : "codex";
      const binDir = join(process.env.APPDATA, "npm", "node_modules", "@openai", "codex", "node_modules", "@openai", platformPackage, "vendor", triple, "codex");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(join(binDir, binName), "fake-binary", { mode: 0o755 });

      const result = findCodexBinary();
      expect(result).toBe(join(binDir, binName));
    } finally {
      process.chdir(originalCwd);
      if (originalPath !== undefined) {
        process.env.PATH = originalPath;
      } else {
        delete process.env.PATH;
      }
      if (originalAppData !== undefined) {
        process.env.APPDATA = originalAppData;
      } else {
        delete process.env.APPDATA;
      }
      if (originalLocalAppData !== undefined) {
        process.env.LOCALAPPDATA = originalLocalAppData;
      } else {
        delete process.env.LOCALAPPDATA;
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns undefined when the Codex binary is not found anywhere", () => {
    const tmp = mkdtempSync(join(tmpdir(), "codex-test-empty-"));
    const originalCwd = process.cwd();
    const originalPath = process.env.PATH;
    const originalAppData = process.env.APPDATA;
    const originalLocalAppData = process.env.LOCALAPPDATA;
    try {
      process.chdir(tmp);
      // Clear PATH so no system binary is found
      process.env.PATH = tmp;
      process.env.APPDATA = join(tmp, "Roaming");
      process.env.LOCALAPPDATA = join(tmp, "Local");
      const result = findCodexBinary();
      expect(result).toBeUndefined();
    } finally {
      process.chdir(originalCwd);
      if (originalPath !== undefined) {
        process.env.PATH = originalPath;
      } else {
        delete process.env.PATH;
      }
      if (originalAppData !== undefined) {
        process.env.APPDATA = originalAppData;
      } else {
        delete process.env.APPDATA;
      }
      if (originalLocalAppData !== undefined) {
        process.env.LOCALAPPDATA = originalLocalAppData;
      } else {
        delete process.env.LOCALAPPDATA;
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
