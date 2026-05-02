import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { localTestConfig } from "./test-config.js";

async function ownerAndRoom(app: FastifyInstance) {
  const created = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } });
  return created.json() as { room_id: string; owner_token: string; owner_id: string };
}

function addressOf(app: Awaited<ReturnType<typeof buildServer>>): string {
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind to a TCP port");
  return `127.0.0.1:${address.port}`;
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("websocket failed to open")), { once: true });
  });
}

describe("POST /rooms/:roomId/main-inputs", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("returns 409 when no active agent exists", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = await ownerAndRoom(app);

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/main-inputs`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "Hello agent" }
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "active_agent_unavailable" });
  });

  it("returns 409 when local agent is online but not session-ready", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = await ownerAndRoom(app);

    const agentRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agents/register`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { name: "Claude", capabilities: ["claude-code"] }
    });
    expect(agentRes.statusCode).toBe(201);
    const agent = agentRes.json() as { agent_id: string };

    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agents/select`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { agent_id: agent.agent_id }
    });

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/main-inputs`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "Hello agent" }
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "agent_session_not_ready" });
  });

  it("opens a new orbit round when triggering an agent turn", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const room = await ownerAndRoom(app);

    const agentRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agents/register`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { name: "LLM Agent", capabilities: ["llm-api"] }
    });
    expect(agentRes.statusCode).toBe(201);
    const agent = agentRes.json() as { agent_id: string };

    await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agents/select`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { agent_id: agent.agent_id }
    });

    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
    await waitForOpen(ws);

    const receivedEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const messagePromise = new Promise<void>((resolve) => {
      ws.addEventListener("message", (msg) => {
        const parsed = JSON.parse(msg.data as string);
        receivedEvents.push(parsed);
        // The handshake may emit a synthetic pre-round orbit.round.opened
        // (T3 reconnect replay). Wait for the live, turn-triggered one.
        if (parsed.type === "orbit.round.opened" && parsed.payload.triggered_by_turn_id) resolve();
      });
    });

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/main-inputs`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "Trigger turn" }
    });

    expect(res.statusCode).toBe(201);
    await messagePromise;
    ws.close();

    const roundEvents = receivedEvents.filter((e) => e.type === "orbit.round.opened");
    expect(roundEvents.length).toBeGreaterThanOrEqual(1);
    const roundEvent = roundEvents[roundEvents.length - 1];
    expect(roundEvent.payload.round_id).toMatch(/^orbit_round_turn_turn_/);
    expect(roundEvent.payload.triggered_by_turn_id).toMatch(/^turn_/);
  });
});

describe("POST /rooms/:roomId/main-inputs/:inputId/cancel", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("requires owner/admin to cancel", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const room = await ownerAndRoom(app);

    const res = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/main-inputs/input_1/cancel`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {}
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "input_not_found" });
  });
});
