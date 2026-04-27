import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildConnectionCode } from "@cacp/protocol";
import { defaultConnectorWorkingDir, loadRuntimeConfigFromArgs, parseAdapterArgs, resolveConnectorWorkingDir } from "../src/config.js";

describe("adapter config arguments", () => {
  it("parses pairing mode arguments with raw token", () => {
    expect(parseAdapterArgs(["--server", "http://127.0.0.1:3737", "--pair", "cacp_pair"])).toEqual({ mode: "pair", server_url: "http://127.0.0.1:3737", pairing_token: "cacp_pair" });
  });

  it("parses --connect connection codes", () => {
    const code = buildConnectionCode({
      server_url: "https://cacp.example.com",
      pairing_token: "cacp_pair",
      expires_at: "2026-04-27T08:15:00.000Z"
    });
    expect(parseAdapterArgs(["--connect", code])).toEqual({ mode: "connect", connection_code: code });
  });

  it("uses prompt mode when double-clicked without args", () => {
    expect(parseAdapterArgs([])).toEqual({ mode: "prompt" });
  });

  it("claims pairing tokens and returns a runtime config without manual room token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      room_id: "room_1",
      agent_id: "agent_1",
      agent_token: "agent_token",
      agent: { name: "Echo", command: "node", args: ["-e", ""], working_dir: ".", capabilities: ["echo"] }
    }), { status: 201, headers: { "content-type": "application/json" } }));

    const config = await loadRuntimeConfigFromArgs(["--server", "http://127.0.0.1:3737", "--pair", "pair_1"], fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:3737/agent-pairings/pair_1/claim?server_url=http%3A%2F%2F127.0.0.1%3A3737", expect.objectContaining({ method: "POST" }));
    expect(config.registered_agent).toEqual({ agent_id: "agent_1", agent_token: "agent_token" });
    expect(config.room_id).toBe("room_1");
    expect(config.agent.name).toBe("Echo");
  });

  it("claims a pairing from a connection code", async () => {
    const code = buildConnectionCode({
      server_url: "https://cacp.example.com",
      pairing_token: "cacp_pair",
      expires_at: "2026-04-27T08:15:00.000Z"
    });
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe("https://cacp.example.com/agent-pairings/cacp_pair/claim?server_url=https%3A%2F%2Fcacp.example.com");
      return new Response(JSON.stringify({
        room_id: "room_alpha",
        agent_id: "agent_alpha",
        agent_token: "cacp_agent",
        agent: { name: "Codex", command: "echo", args: [], working_dir: ".", capabilities: ["shell.oneshot"] }
      }), { status: 201, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const config = await loadRuntimeConfigFromArgs(["--connect", code], fetchImpl);
    expect(config.registered_agent?.agent_token).toBe("cacp_agent");
  });

  it("rejects invalid connection code during load", async () => {
    await expect(loadRuntimeConfigFromArgs(["--connect", "CACP-CONNECT:v1:invalid"])).rejects.toThrow();
  });

  it("parses --cwd for pairing mode", () => {
    expect(parseAdapterArgs(["--server", "http://127.0.0.1:3737", "--pair", "cacp_pair", "--cwd", "D:\\Projects\\my-app"])).toEqual({
      mode: "pair",
      server_url: "http://127.0.0.1:3737",
      pairing_token: "cacp_pair",
      cwd: "D:\\Projects\\my-app"
    });
  });

  it("sends resolved working_dir while claiming a pairing", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cacp-cli-cwd-"));
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ working_dir: tempDir });
      return new Response(JSON.stringify({
        room_id: "room_1",
        agent_id: "agent_1",
        agent_token: "agent_token",
        agent: { name: "Echo", command: "node", args: ["-e", ""], working_dir: tempDir, capabilities: ["echo"] }
      }), { status: 201, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    try {
      const config = await loadRuntimeConfigFromArgs(["--server", "http://127.0.0.1:3737", "--pair", "pair_1", "--cwd", tempDir], fetchMock);
      expect(config.agent.working_dir).toBe(tempDir);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("uses executable directory for packaged connector default cwd", () => {
    expect(defaultConnectorWorkingDir({
      argv: ["C:\\Tools\\CACP-Local-Connector.exe"],
      cwd: () => "D:\\Shell",
      execPath: "C:\\Tools\\CACP-Local-Connector.exe"
    })).toBe("C:\\Tools");
  });

  it("uses process cwd for developer CLI default cwd", () => {
    expect(defaultConnectorWorkingDir({
      argv: ["C:\\Program Files\\nodejs\\node.exe", "D:\\Development\\2\\packages\\cli-adapter\\dist\\index.js"],
      cwd: () => "D:\\Development\\2",
      execPath: "C:\\Program Files\\nodejs\\node.exe"
    })).toBe("D:\\Development\\2");
  });

  it("rejects invalid --cwd before claiming", async () => {
    const missingDir = join(tmpdir(), "cacp-missing-dir-for-test");
    const fetchMock = vi.fn();
    await expect(loadRuntimeConfigFromArgs(["--server", "http://127.0.0.1:3737", "--pair", "pair_1", "--cwd", missingDir], fetchMock as unknown as typeof fetch)).rejects.toThrow("working directory does not exist");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves explicit cwd to an existing directory", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cacp-cli-resolve-"));
    try {
      expect(resolveConnectorWorkingDir(tempDir)).toBe(tempDir);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
