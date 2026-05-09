import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findCopilotCli, findCopilotPackage, createCopilotSdkFromModule } from "../src/copilot/copilot-sdk.js";

describe("Copilot SDK boundary", () => {
  it("creates CopilotClient with an explicit cliPath", () => {
    const constructorOptions: unknown[] = [];
    class FakeCopilotClient {
      constructor(options: unknown) {
        constructorOptions.push(options);
      }
      async createSession() { return { sessionId: "s1", send: async () => "", abort: async () => {}, disconnect: async () => {}, on: () => () => {} }; }
      async resumeSession() { return { sessionId: "s1", send: async () => "", abort: async () => {}, disconnect: async () => {}, on: () => () => {} }; }
      async listSessions() { return []; }
      async start() {}
      async stop() { return []; }
    }

    const sdk = createCopilotSdkFromModule({ CopilotClient: FakeCopilotClient }, { cliPath: "/path/to/copilot/index.js" });
    expect(constructorOptions[0]).toMatchObject({ cliPath: "/path/to/copilot/index.js", useStdio: true, autoStart: true });
    expect(sdk).toBeDefined();
  });
});

describe("findCopilotCli", () => {
  it("returns undefined when gh is not on PATH and no env override is set", () => {
    const originalPath = process.env.PATH;
    const originalAppData = process.env.APPDATA;
    const originalLocalAppData = process.env.LOCALAPPDATA;
    const tmp = mkdtempSync(join(tmpdir(), "copilot-test-empty-"));
    try {
      process.env.PATH = tmp;
      delete process.env.APPDATA;
      delete process.env.LOCALAPPDATA;
      delete process.env.CACP_COPILOT_PATH;
      const result = findCopilotCli();
      expect(result).toBeUndefined();
    } finally {
      if (originalPath !== undefined) process.env.PATH = originalPath;
      else delete process.env.PATH;
      if (originalAppData !== undefined) process.env.APPDATA = originalAppData;
      else delete process.env.APPDATA;
      if (originalLocalAppData !== undefined) process.env.LOCALAPPDATA = originalLocalAppData;
      else delete process.env.LOCALAPPDATA;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("findCopilotPackage", () => {
  it("finds @github/copilot in a pnpm virtual store layout", () => {
    const tmp = mkdtempSync(join(tmpdir(), "copilot-pnpm-test-"));
    const originalCwd = process.cwd();
    try {
      process.chdir(tmp);
      const pkgDir = join(tmp, "node_modules", ".pnpm", "@github+copilot@1.0.43", "node_modules", "@github", "copilot");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, "index.js"), "// fake");

      const result = findCopilotPackage();
      expect(result).toBe(join(pkgDir, "index.js"));
    } finally {
      process.chdir(originalCwd);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("finds @github/copilot in a standard npm local install", () => {
    const tmp = mkdtempSync(join(tmpdir(), "copilot-local-test-"));
    const originalCwd = process.cwd();
    try {
      process.chdir(tmp);
      const pkgDir = join(tmp, "node_modules", "@github", "copilot");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, "index.js"), "// fake");

      const result = findCopilotPackage();
      expect(result).toBe(join(pkgDir, "index.js"));
    } finally {
      process.chdir(originalCwd);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("finds @github/copilot in an npm global install", () => {
    const tmp = mkdtempSync(join(tmpdir(), "copilot-global-test-"));
    const originalCwd = process.cwd();
    const originalAppData = process.env.APPDATA;
    const originalLocalAppData = process.env.LOCALAPPDATA;
    try {
      process.chdir(tmp);
      process.env.APPDATA = join(tmp, "Roaming");
      process.env.LOCALAPPDATA = join(tmp, "Local");
      const pkgDir = join(process.env.APPDATA, "npm", "node_modules", "@github", "copilot");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(join(pkgDir, "index.js"), "// fake");

      const result = findCopilotPackage();
      expect(result).toBe(join(pkgDir, "index.js"));
    } finally {
      process.chdir(originalCwd);
      if (originalAppData !== undefined) process.env.APPDATA = originalAppData;
      else delete process.env.APPDATA;
      if (originalLocalAppData !== undefined) process.env.LOCALAPPDATA = originalLocalAppData;
      else delete process.env.LOCALAPPDATA;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns undefined when @github/copilot is not found anywhere", () => {
    const tmp = mkdtempSync(join(tmpdir(), "copilot-empty-test-"));
    const originalCwd = process.cwd();
    const originalAppData = process.env.APPDATA;
    const originalLocalAppData = process.env.LOCALAPPDATA;
    try {
      process.chdir(tmp);
      delete process.env.APPDATA;
      delete process.env.LOCALAPPDATA;
      const result = findCopilotPackage();
      expect(result).toBeUndefined();
    } finally {
      process.chdir(originalCwd);
      if (originalAppData !== undefined) process.env.APPDATA = originalAppData;
      else delete process.env.APPDATA;
      if (originalLocalAppData !== undefined) process.env.LOCALAPPDATA = originalLocalAppData;
      else delete process.env.LOCALAPPDATA;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
