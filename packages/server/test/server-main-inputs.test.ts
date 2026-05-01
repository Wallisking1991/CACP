import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { localTestConfig } from "./test-config.js";

async function ownerAndRoom(app: FastifyInstance) {
  const created = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Room", display_name: "Owner" } });
  return created.json() as { room_id: string; owner_token: string; owner_id: string };
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
