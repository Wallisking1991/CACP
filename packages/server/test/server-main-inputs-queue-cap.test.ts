import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { localTestConfig } from "./test-config.js";

async function ownerAndRoom(app: FastifyInstance) {
  const created = await app.inject({
    method: "POST",
    url: "/rooms",
    payload: { name: "Room", display_name: "Owner" }
  });
  return created.json() as { room_id: string; owner_token: string; owner_id: string };
}

async function setupRoomWithAgent(app: FastifyInstance) {
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

describe("queuedMainInputs per-room cap", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it("accepts 50 queued inputs but rejects the 51st with 409 queue_full", async () => {
    app = await buildServer({ dbPath: ":memory:", config: localTestConfig() });
    const { room } = await setupRoomWithAgent(app);

    // First input opens a turn (does not occupy the queue set).
    const opener = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/main-inputs`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "open turn" }
    });
    expect(opener.statusCode).toBe(201);
    expect((opener.json() as { status: string }).status).toBe("triggered");

    // Now queue 50 inputs — turn is still open, so each should be queued.
    for (let i = 0; i < 50; i += 1) {
      const res = await app.inject({
        method: "POST",
        url: `/rooms/${room.room_id}/main-inputs`,
        headers: { authorization: `Bearer ${room.owner_token}` },
        payload: { text: `queued ${i}` }
      });
      expect(res.statusCode).toBe(201);
      expect((res.json() as { status: string }).status).toBe("queued");
    }

    // The 51st queued input should be rejected with 409 queue_full.
    const overflow = await app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/main-inputs`,
      headers: { authorization: `Bearer ${room.owner_token}` },
      payload: { text: "overflow" }
    });
    expect(overflow.statusCode).toBe(409);
    expect(overflow.json()).toMatchObject({ error: "queue_full" });
  });
});
