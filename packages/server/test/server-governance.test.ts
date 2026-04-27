import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseConnectionCode } from "@cacp/protocol";
import { buildLocalAgentConsoleScript, buildLocalAgentConsoleSpawnCommand, buildServer, defaultLocalAgentLauncher } from "../src/server.js";

async function createRoom() {
  const app = await buildServer({ dbPath: ":memory:" });
  const response = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Governed Room", display_name: "Alice" } });
  expect(response.statusCode).toBe(201);
  const room = response.json() as { room_id: string; owner_token: string; owner_id: string };
  return { app, room, ownerAuth: { authorization: `Bearer ${room.owner_token}` } };
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(condition()).toBe(true);
}

describe("CACP server pairing and room governance", () => {
  it("creates expiring invite links and lets invited participants join by name", async () => {
    const { app, room, ownerAuth } = await createRoom();

    const invite = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: ownerAuth, payload: { role: "member", expires_in_seconds: 3600 } });
    expect(invite.statusCode).toBe(201);
    expect(invite.json().expires_at).toBeTruthy();

    const pending = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/join-requests`, payload: { invite_token: invite.json().invite_token, display_name: "Bob" } });
    expect(pending.statusCode).toBe(201);
    const request = pending.json() as { request_id: string; request_token: string };
    const approved = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/join-requests/${request.request_id}/approve`, headers: ownerAuth, payload: {} });
    expect(approved.statusCode).toBe(201);
    const status = await app.inject({ method: "GET", url: `/rooms/${room.room_id}/join-requests/${request.request_id}?request_token=${encodeURIComponent(request.request_token)}` });
    expect(status.json().role).toBe("member");

    const expired = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: ownerAuth, payload: { role: "observer", expires_in_seconds: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const expiredJoin = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/join-requests`, payload: { invite_token: expired.json().invite_token, display_name: "Too Late" } });
    expect(expiredJoin.statusCode).toBe(401);
    expect(expiredJoin.json()).toEqual({ error: "invite_expired" });

    await app.close();
  });

  it("creates a pairing command and lets an adapter claim it as an online agent", async () => {
    const { app, room, ownerAuth } = await createRoom();

    const pairing = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-pairings`, headers: ownerAuth, payload: { agent_type: "claude-code", permission_level: "limited_write", working_dir: "D:\\Development\\2" } });
    expect(pairing.statusCode).toBe(201);
    const pairingBody = pairing.json() as { connection_code: string; expires_at: string; download_url: string };
    expect(pairingBody.connection_code).toContain("CACP-CONNECT");
    const parsed = parseConnectionCode(pairingBody.connection_code);
    expect(parsed.pairing_token).toBeTruthy();

    const claim = await app.inject({ method: "POST", url: `/agent-pairings/${parsed.pairing_token}/claim`, payload: { adapter_name: "Claude Local" } });
    expect(claim.statusCode).toBe(201);
    expect(claim.json().room_id).toBe(room.room_id);
    expect(claim.json().agent.name).toBe("Claude Code Agent");
    expect(claim.json().agent.capabilities).toContain("manual_flow_control");

    const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["agent.pairing_created", "agent.registered", "agent.status_changed", "room.agent_selected"]));
    expect(events.find((event) => event.type === "agent.status_changed")?.payload.status).toBe("online");
    expect(events.find((event) => event.type === "room.agent_selected")?.payload.agent_id).toBe(claim.json().agent_id);

    const secondClaim = await app.inject({ method: "POST", url: `/agent-pairings/${parsed.pairing_token}/claim`, payload: {} });
    expect(secondClaim.statusCode).toBe(409);

    await app.close();
  });

  it("does not override an existing active agent when another paired adapter claims", async () => {
    const { app, room, ownerAuth } = await createRoom();
    const firstPairing = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-pairings`, headers: ownerAuth, payload: { agent_type: "echo", permission_level: "read_only", working_dir: "D:\\Development\\2" } });
    const firstToken = parseConnectionCode((firstPairing.json() as { connection_code: string }).connection_code).pairing_token;
    const firstClaim = await app.inject({ method: "POST", url: `/agent-pairings/${firstToken}/claim`, payload: { adapter_name: "First Agent" } });
    expect(firstClaim.statusCode).toBe(201);

    const secondPairing = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-pairings`, headers: ownerAuth, payload: { agent_type: "echo", permission_level: "read_only", working_dir: "D:\\Development\\2" } });
    const secondToken = parseConnectionCode((secondPairing.json() as { connection_code: string }).connection_code).pairing_token;
    const secondClaim = await app.inject({ method: "POST", url: `/agent-pairings/${secondToken}/claim`, payload: { adapter_name: "Second Agent" } });
    expect(secondClaim.statusCode).toBe(201);

    const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    const selections = events.filter((event) => event.type === "room.agent_selected");
    expect(selections).toHaveLength(1);
    expect(selections[0].payload.agent_id).toBe(firstClaim.json().agent_id);

    await app.close();
  });

  it("logs action approval requests without creating structured decisions", async () => {
    const { app, room, ownerAuth } = await createRoom();
    const agent = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agents/register`, headers: ownerAuth, payload: { name: "Claude", capabilities: [] } });
    const agentToken = agent.json().agent_token;

    const approval = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-action-approvals?token=${encodeURIComponent(agentToken)}&wait_ms=2000`, payload: { tool_name: "Write", description: "Allow Write?" } });
    expect(approval.statusCode).toBe(201);
    expect(approval.json()).toMatchObject({ status: "rejected", result: "reject", reason: "manual_flow_control_required" });
    expect(approval.json().decision_id).toBeUndefined();

    const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["agent.action_approval_requested", "agent.action_approval_resolved"]));
    expect(events.some((event) => event.type.startsWith("decision."))).toBe(false);
    expect(events.find((event) => event.type === "agent.action_approval_resolved")?.payload).toMatchObject({ action_id: approval.json().action_id, result: "reject", reason: "manual_flow_control_required" });

    await app.close();
  });

  it("uses an explicit adapter server URL when creating a pairing behind the web dev proxy", async () => {
    const { app, room, ownerAuth } = await createRoom();

    const pairing = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-pairings`,
      headers: { ...ownerAuth, host: "127.0.0.1:5173" },
      payload: { agent_type: "echo", permission_level: "read_only", working_dir: "D:\\Development\\2", server_url: "http://127.0.0.1:3737" }
    });

    expect(pairing.statusCode).toBe(201);
    const pairingBody = pairing.json() as { connection_code: string };
    const parsed = parseConnectionCode(pairingBody.connection_code);
    expect(parsed.server_url).toBe("http://127.0.0.1:3737");
    expect(parsed.server_url).not.toBe("http://127.0.0.1:5173");

    await app.close();
  });

  it("starts a local adapter process for localhost rooms without executing a web-supplied command", async () => {
    const launches: unknown[] = [];
    const app = await buildServer({
      dbPath: ":memory:",
      localAgentLauncher: async (input) => {
        launches.push(input);
        return { pid: 4242 };
      }
    });
    const response = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Governed Room", display_name: "Alice" } });
    const room = response.json() as { room_id: string; owner_token: string };
    const ownerAuth = { authorization: `Bearer ${room.owner_token}`, host: "127.0.0.1:5173" };

    const started = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-pairings/start-local`,
      headers: ownerAuth,
      payload: {
        agent_type: "claude-code",
        permission_level: "read_only",
        working_dir: "D:\\Development\\2",
        server_url: "http://127.0.0.1:3737",
        command: "powershell Remove-Item -Recurse C:\\"
      }
    });

    expect(started.statusCode).toBe(201);
    expect(started.json()).toMatchObject({ status: "starting", pid: 4242 });
    expect(started.json().command).toContain("npx @cacp/cli-adapter --server http://127.0.0.1:3737 --pair ");
    expect(started.json().command).not.toContain("Remove-Item");
    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({
      command: "corepack",
      args: expect.arrayContaining(["pnpm", "--filter", "@cacp/cli-adapter", "dev", "--", "--server", "http://127.0.0.1:3737", "--pair"]),
      cwd: expect.stringContaining("Development"),
      showConsole: true
    });

    const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    expect(events.map((event) => event.type)).toContain("agent.pairing_created");

    await app.close();
  });

  it("builds a visible local adapter console script with a red do-not-close warning", () => {
    const script = buildLocalAgentConsoleScript({
      launchId: "launch_test",
      command: process.execPath,
      args: ["-e", "console.log('fake adapter started')"],
      cwd: "D:\\Development\\2",
      outLog: "D:\\Development\\2\\.tmp-test-services\\adapters\\launch_test.out.log",
      errLog: "D:\\Development\\2\\.tmp-test-services\\adapters\\launch_test.err.log",
      showConsole: true
    });

    expect(script).toContain("WARNING: CACP LOCAL AGENT BRIDGE IS RUNNING");
    expect(script).toContain("This console was opened by the AI Collaboration Platform Demo.");
    expect(script).toContain("Do not close or delete this window while using the web room.");
    expect(script).toContain("Closing it will disconnect the local CLI agent from the shared room.");
    expect(script).toContain("-ForegroundColor Red");
  });

  it("launches the visible local adapter console through cmd start on Windows", () => {
    const launch = buildLocalAgentConsoleSpawnCommand("D:\\Development\\2\\.tmp-test-services\\adapters\\launch_test.ps1");

    expect(launch.command.toLowerCase()).toBe("cmd.exe");
    expect(launch.args).toEqual(expect.arrayContaining([
      "/d",
      "/c",
      "start",
      "CACP Local Agent Bridge - DO NOT CLOSE",
      "powershell.exe",
      "-NoExit",
      "-File",
      "D:\\Development\\2\\.tmp-test-services\\adapters\\launch_test.ps1"
    ]));
  });

  it("rejects local adapter launches from non-localhost requests", async () => {
    const launcher = vi.fn();
    const app = await buildServer({ dbPath: ":memory:", localAgentLauncher: launcher });
    const response = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Governed Room", display_name: "Alice" } });
    const room = response.json() as { room_id: string; owner_token: string };

    const started = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-pairings/start-local`,
      headers: { authorization: `Bearer ${room.owner_token}`, host: "cacp.example.com" },
      payload: { agent_type: "echo", permission_level: "read_only", working_dir: ".", server_url: "https://cacp.example.com" }
    });

    expect(started.statusCode).toBe(400);
    expect(started.json()).toEqual({ error: "local_launch_requires_localhost" });
    expect(launcher).not.toHaveBeenCalled();

    await app.close();
  });

  it("starts the default local adapter launcher without failing on unopened log streams", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "cacp-local-launch-"));
    try {
      const outLog = join(repoRoot, "adapter.out.log");
      const errLog = join(repoRoot, "adapter.err.log");
      const launched = defaultLocalAgentLauncher({
        launchId: "launch_test",
        command: process.execPath,
        args: ["-e", "console.log('fake adapter started')"],
        cwd: process.cwd(),
        outLog,
        errLog
      });

      expect(launched.pid).toEqual(expect.any(Number));
      await waitFor(() => existsSync(outLog) && readFileSync(outLog, "utf8").includes("fake adapter started"));
      expect(existsSync(errLog)).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
