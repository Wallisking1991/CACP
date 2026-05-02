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
        // (T3 reconnect replay). Wait for the live, turn-triggered one —
        // require triggered_by_turn_id to be a non-empty string rather than
        // just truthy, so we can't accidentally accept a stale value.
        if (
          parsed.type === "orbit.round.opened" &&
          typeof parsed.payload.triggered_by_turn_id === "string" &&
          parsed.payload.triggered_by_turn_id.length > 0
        ) resolve();
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

async function setupRoomWithReadyAgent(app: FastifyInstance) {
  const room = await ownerAndRoom(app);
  const agentReg = await app.inject({
    method: "POST",
    url: `/rooms/${room.room_id}/agents/register`,
    headers: { authorization: `Bearer ${room.owner_token}` },
    payload: { name: "TestAgent", capabilities: ["llm-api"] }
  });
  const agent = agentReg.json() as { agent_id: string; agent_token: string };
  await app.inject({
    method: "POST",
    url: `/rooms/${room.room_id}/agents/select`,
    headers: { authorization: `Bearer ${room.owner_token}` },
    payload: { agent_id: agent.agent_id }
  });
  return { room, agent };
}

async function postMainInput(app: FastifyInstance, roomId: string, ownerToken: string, text: string) {
  return app.inject({
    method: "POST",
    url: `/rooms/${roomId}/main-inputs`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { text }
  });
}

async function startTurn(app: FastifyInstance, roomId: string, agentToken: string, turnId: string) {
  const res = await app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agent-turns/${turnId}/start`,
    headers: { authorization: `Bearer ${agentToken}` },
    payload: {}
  });
  expect(res.statusCode).toBe(201);
}

async function completeTurn(app: FastifyInstance, roomId: string, agentToken: string, turnId: string, finalText = "done") {
  return app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agent-turns/${turnId}/complete`,
    headers: { authorization: `Bearer ${agentToken}` },
    payload: { final_text: finalText, exit_code: 0 }
  });
}

async function failTurn(app: FastifyInstance, roomId: string, agentToken: string, turnId: string, error: string) {
  return app.inject({
    method: "POST",
    url: `/rooms/${roomId}/agent-turns/${turnId}/fail`,
    headers: { authorization: `Bearer ${agentToken}` },
    payload: { error }
  });
}

function collectWsEvents(ws: WebSocket): Array<{ type: string; payload: Record<string, unknown> }> {
  const arr: Array<{ type: string; payload: Record<string, unknown> }> = [];
  ws.addEventListener("message", (msg) => {
    arr.push(JSON.parse(msg.data as string));
  });
  return arr;
}

async function waitForEvent(events: Array<{ type: string; payload: Record<string, unknown> }>, predicate: (ev: { type: string; payload: Record<string, unknown> }) => boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (events.some(predicate)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for predicate; received: ${events.map((e) => e.type).join(",")}`);
}

describe("FIFO main-input auto-trigger on agent turn completion (T5)", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("triggers FIFO head after agent.turn.completed and keeps remaining queued", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { room, agent } = await setupRoomWithReadyAgent(app);
    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
    await waitForOpen(ws);
    const received = collectWsEvents(ws);

    const r1 = await postMainInput(app, room.room_id, room.owner_token, "first");
    expect(r1.statusCode).toBe(201);
    expect((r1.json() as { status: string }).status).toBe("triggered");
    const firstInput = (r1.json() as { input_id: string }).input_id;

    await waitForEvent(received, (e) => e.type === "agent.turn.requested");
    const firstTurnReq = received.find((e) => e.type === "agent.turn.requested")!;
    const firstTurnId = String(firstTurnReq.payload.turn_id);

    // Queue input #2 and #3 while turn #1 is in flight.
    const r2 = await postMainInput(app, room.room_id, room.owner_token, "second");
    expect((r2.json() as { status: string }).status).toBe("queued");
    const secondInput = (r2.json() as { input_id: string }).input_id;
    const r3 = await postMainInput(app, room.room_id, room.owner_token, "third");
    expect((r3.json() as { status: string }).status).toBe("queued");
    const thirdInput = (r3.json() as { input_id: string }).input_id;

    await startTurn(app, room.room_id, agent.agent_token, firstTurnId);
    received.length = 0;

    const completeRes = await completeTurn(app, room.room_id, agent.agent_token, firstTurnId);
    expect(completeRes.statusCode).toBe(201);

    await waitForEvent(received, (e) => e.type === "main_input.triggered" && e.payload.input_id === secondInput);
    const triggered = received.find((e) => e.type === "main_input.triggered" && e.payload.input_id === secondInput)!;
    const newTurnReq = received.find((e) => e.type === "agent.turn.requested" && e.payload.turn_id === triggered.payload.trigger_turn_id);
    expect(newTurnReq).toBeDefined();
    expect(newTurnReq!.payload.message_text).toBe("second");

    // Third should still be queued (not yet triggered).
    expect(received.some((e) => e.type === "main_input.triggered" && e.payload.input_id === thirdInput)).toBe(false);

    // Sanity: first input is not re-triggered.
    expect(received.filter((e) => e.type === "main_input.triggered" && e.payload.input_id === firstInput)).toHaveLength(0);

    ws.close();
  });

  it("continues FIFO across multiple completions until queue empty", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { room, agent } = await setupRoomWithReadyAgent(app);
    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
    await waitForOpen(ws);
    const received = collectWsEvents(ws);

    const r1 = await postMainInput(app, room.room_id, room.owner_token, "first");
    await waitForEvent(received, (e) => e.type === "agent.turn.requested");
    const firstTurnId = String(received.find((e) => e.type === "agent.turn.requested")!.payload.turn_id);
    const r2 = await postMainInput(app, room.room_id, room.owner_token, "second");
    const secondInput = (r2.json() as { input_id: string }).input_id;
    const r3 = await postMainInput(app, room.room_id, room.owner_token, "third");
    const thirdInput = (r3.json() as { input_id: string }).input_id;

    expect(r1.statusCode).toBe(201);

    await startTurn(app, room.room_id, agent.agent_token, firstTurnId);
    received.length = 0;
    await completeTurn(app, room.room_id, agent.agent_token, firstTurnId);

    await waitForEvent(received, (e) => e.type === "main_input.triggered" && e.payload.input_id === secondInput);
    const secondTriggered = received.find((e) => e.type === "main_input.triggered" && e.payload.input_id === secondInput)!;
    const secondTurnId = String(secondTriggered.payload.trigger_turn_id);
    await startTurn(app, room.room_id, agent.agent_token, secondTurnId);
    received.length = 0;
    await completeTurn(app, room.room_id, agent.agent_token, secondTurnId);

    await waitForEvent(received, (e) => e.type === "main_input.triggered" && e.payload.input_id === thirdInput);
    const thirdTriggered = received.find((e) => e.type === "main_input.triggered" && e.payload.input_id === thirdInput)!;
    const thirdTurnReq = received.find((e) => e.type === "agent.turn.requested" && e.payload.turn_id === thirdTriggered.payload.trigger_turn_id);
    expect(thirdTurnReq?.payload.message_text).toBe("third");

    // Now complete the third turn → queue should be empty, no new triggered.
    const thirdTurnId = String(thirdTriggered.payload.trigger_turn_id);
    await startTurn(app, room.room_id, agent.agent_token, thirdTurnId);
    received.length = 0;
    await completeTurn(app, room.room_id, agent.agent_token, thirdTurnId);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received.some((e) => e.type === "main_input.triggered")).toBe(false);
    expect(received.some((e) => e.type === "agent.turn.requested")).toBe(false);

    ws.close();
  });

  it("auto-triggers next queued input after non-blocking failure", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { room, agent } = await setupRoomWithReadyAgent(app);
    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
    await waitForOpen(ws);
    const received = collectWsEvents(ws);

    await postMainInput(app, room.room_id, room.owner_token, "first");
    await waitForEvent(received, (e) => e.type === "agent.turn.requested");
    const firstTurnId = String(received.find((e) => e.type === "agent.turn.requested")!.payload.turn_id);
    const r2 = await postMainInput(app, room.room_id, room.owner_token, "second");
    const secondInput = (r2.json() as { input_id: string }).input_id;

    await startTurn(app, room.room_id, agent.agent_token, firstTurnId);
    received.length = 0;
    const failRes = await failTurn(app, room.room_id, agent.agent_token, firstTurnId, "internal_error");
    expect(failRes.statusCode).toBe(201);

    await waitForEvent(received, (e) => e.type === "main_input.triggered" && e.payload.input_id === secondInput);

    ws.close();
  });

  it("halts queue when failure error indicates agent offline", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { room, agent } = await setupRoomWithReadyAgent(app);
    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
    await waitForOpen(ws);
    const received = collectWsEvents(ws);

    await postMainInput(app, room.room_id, room.owner_token, "first");
    await waitForEvent(received, (e) => e.type === "agent.turn.requested");
    const firstTurnId = String(received.find((e) => e.type === "agent.turn.requested")!.payload.turn_id);
    const r2 = await postMainInput(app, room.room_id, room.owner_token, "second");
    const secondInput = (r2.json() as { input_id: string }).input_id;

    await startTurn(app, room.room_id, agent.agent_token, firstTurnId);
    received.length = 0;
    await failTurn(app, room.room_id, agent.agent_token, firstTurnId, "active_agent_offline");

    // Give some time for any spurious trigger to land.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(received.some((e) => e.type === "main_input.triggered" && e.payload.input_id === secondInput)).toBe(false);

    ws.close();
  });

  it("skips cancelled inputs when popping the FIFO head", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { room, agent } = await setupRoomWithReadyAgent(app);
    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
    await waitForOpen(ws);
    const received = collectWsEvents(ws);

    await postMainInput(app, room.room_id, room.owner_token, "first");
    await waitForEvent(received, (e) => e.type === "agent.turn.requested");
    const firstTurnId = String(received.find((e) => e.type === "agent.turn.requested")!.payload.turn_id);
    const r2 = await postMainInput(app, room.room_id, room.owner_token, "second");
    const secondInput = (r2.json() as { input_id: string }).input_id;
    const r3 = await postMainInput(app, room.room_id, room.owner_token, "third");
    const thirdInput = (r3.json() as { input_id: string }).input_id;

    // Cancel the second input.
    const cancelRes = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/main-inputs/${secondInput}/cancel`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: {}
    });
    expect(cancelRes.statusCode).toBe(201);

    await startTurn(app, room.room_id, agent.agent_token, firstTurnId);
    received.length = 0;
    await completeTurn(app, room.room_id, agent.agent_token, firstTurnId);

    await waitForEvent(received, (e) => e.type === "main_input.triggered" && e.payload.input_id === thirdInput);
    expect(received.some((e) => e.type === "main_input.triggered" && e.payload.input_id === secondInput)).toBe(false);
    const triggered = received.find((e) => e.type === "main_input.triggered" && e.payload.input_id === thirdInput)!;
    const newTurnReq = received.find((e) => e.type === "agent.turn.requested" && e.payload.turn_id === triggered.payload.trigger_turn_id);
    expect(newTurnReq?.payload.message_text).toBe("third");

    ws.close();
  });

  it("is a no-op when the queue is empty on completion", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { room, agent } = await setupRoomWithReadyAgent(app);
    const ws = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${room.owner_token}`);
    await waitForOpen(ws);
    const received = collectWsEvents(ws);

    await postMainInput(app, room.room_id, room.owner_token, "first");
    await waitForEvent(received, (e) => e.type === "agent.turn.requested");
    const firstTurnId = String(received.find((e) => e.type === "agent.turn.requested")!.payload.turn_id);
    await startTurn(app, room.room_id, agent.agent_token, firstTurnId);
    received.length = 0;
    await completeTurn(app, room.room_id, agent.agent_token, firstTurnId);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(received.some((e) => e.type === "main_input.triggered")).toBe(false);
    expect(received.some((e) => e.type === "agent.turn.requested")).toBe(false);

    ws.close();
  });
});
