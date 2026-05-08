import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { findKimiCli, createKimiSdkFromModule, loadKimiSdk } from "../src/kimi/kimi-sdk.js";
import type { KimiSdk } from "../src/kimi/types.js";

describe("findKimiCli", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CACP_KIMI_PATH;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns CACP_KIMI_PATH when set and exists", () => {
    // Use a real file (node.exe) to satisfy existsSync check
    const realPath = process.execPath;
    process.env.CACP_KIMI_PATH = realPath;
    const result = findKimiCli();
    expect(result).toBe(realPath);
  });

  it("falls back to PATH scan when CACP_KIMI_PATH is not set", () => {
    delete process.env.CACP_KIMI_PATH;
    const result = findKimiCli();
    // May find or not depending on system PATH; just verify it does not throw
    expect(typeof result === "string" || result === undefined).toBe(true);
  });

  it("returns undefined when no kimi binary is found", () => {
    delete process.env.CACP_KIMI_PATH;
    // Temporarily clear PATH to ensure no binary is found
    const originalPath = process.env.PATH;
    process.env.PATH = "";
    const result = findKimiCli();
    expect(result).toBeUndefined();
    process.env.PATH = originalPath;
  });
});

describe("createKimiSdkFromModule", () => {
  it("throws when module lacks createSession", () => {
    expect(() => createKimiSdkFromModule({})).toThrow("Kimi SDK createSession was not found");
  });

  it("throws when module lacks listSessions", () => {
    expect(() => createKimiSdkFromModule({ createSession: () => ({}) })).toThrow("Kimi SDK listSessions was not found");
  });

  it("wraps createSession and returns a KimiSdkSession", () => {
    const mockSession = {
      sessionId: "sess_123",
      workDir: "/project",
      state: "idle",
      model: "kimi-latest",
      thinking: true,
      yoloMode: false,
      executable: "kimi",
      env: {},
      prompt: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }),
        interrupt: () => Promise.resolve(),
        approve: () => Promise.resolve(),
        result: Promise.resolve({ status: "finished" as const })
      })
    };
    const sdk = createKimiSdkFromModule({
      createSession: () => mockSession,
      listSessions: () => Promise.resolve([]),
      parseSessionEvents: () => Promise.resolve([])
    });

    const session = sdk.createSession({ workDir: "/project" });
    expect(session.sessionId).toBe("sess_123");
    expect(session.workDir).toBe("/project");
    expect(session.state).toBe("idle");
    expect(session.model).toBe("kimi-latest");
    expect(session.thinking).toBe(true);
    expect(session.yoloMode).toBe(false);
    expect(session.executable).toBe("kimi");
    expect(session.env).toEqual({});
  });

  it("wraps listSessions and normalizes results", async () => {
    const sdk = createKimiSdkFromModule({
      createSession: () => ({
        sessionId: "s1",
        workDir: "/p",
        state: "idle",
        prompt: () => ({
          [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }),
          interrupt: () => Promise.resolve(),
          approve: () => Promise.resolve(),
          result: Promise.resolve({ status: "finished" as const })
        })
      }),
      listSessions: () => Promise.resolve([
        { id: "s1", workDir: "/p", contextFile: "ctx.toml", updatedAt: 1700000000000, brief: "Hello" }
      ])
    });

    const sessions = await sdk.listSessions("/p");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual({
      id: "s1",
      workDir: "/p",
      contextFile: "ctx.toml",
      updatedAt: 1700000000000,
      brief: "Hello"
    });
  });

  it("returns empty array when listSessions yields non-array", async () => {
    const sdk = createKimiSdkFromModule({
      createSession: () => ({
        sessionId: "s1",
        workDir: "/p",
        state: "idle",
        prompt: () => ({
          [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }),
          interrupt: () => Promise.resolve(),
          approve: () => Promise.resolve(),
          result: Promise.resolve({ status: "finished" as const })
        })
      }),
      listSessions: () => Promise.resolve(null)
    });

    const sessions = await sdk.listSessions("/p");
    expect(sessions).toEqual([]);
  });

  it("wraps parseSessionEvents", async () => {
    const sdk = createKimiSdkFromModule({
      createSession: () => ({
        sessionId: "s1",
        workDir: "/p",
        state: "idle",
        prompt: () => ({
          [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }),
          interrupt: () => Promise.resolve(),
          approve: () => Promise.resolve(),
          result: Promise.resolve({ status: "finished" as const })
        })
      }),
      listSessions: () => Promise.resolve([]),
      parseSessionEvents: () => Promise.resolve([{ type: "TurnBegin", payload: {} }])
    });

    const events = await sdk.parseSessionEvents("/p", "s1");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "TurnBegin", payload: {} });
  });

  it("returns empty array when parseSessionEvents is missing", async () => {
    const sdk = createKimiSdkFromModule({
      createSession: () => ({
        sessionId: "s1",
        workDir: "/p",
        state: "idle",
        prompt: () => ({
          [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }),
          interrupt: () => Promise.resolve(),
          approve: () => Promise.resolve(),
          result: Promise.resolve({ status: "finished" as const })
        })
      }),
      listSessions: () => Promise.resolve([])
    });

    const events = await sdk.parseSessionEvents("/p", "s1");
    expect(events).toEqual([]);
  });
});
