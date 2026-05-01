import { describe, expect, it } from "vitest";
import { createCodexSdkFromModule } from "../src/codex/codex-sdk.js";
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
});
