import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

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

describe("server websocket close", () => {
  it("can close the server while an agent stream is connected", async () => {
    const app = await buildServer({ dbPath: ":memory:" });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const baseUrl = `http://${addressOf(app)}`;

    const roomResponse = await fetch(`${baseUrl}/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Close Race Room", display_name: "Owner" })
    });
    expect(roomResponse.status).toBe(201);
    const room = await roomResponse.json() as { room_id: string; owner_token: string };
    const agentResponse = await fetch(`${baseUrl}/rooms/${room.room_id}/agents/register`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${room.owner_token}` },
      body: JSON.stringify({ name: "Codex CLI Agent", capabilities: ["codex-cli"] })
    });
    expect(agentResponse.status).toBe(201);
    const agent = await agentResponse.json() as { agent_token: string };

    const socket = new WebSocket(`ws://${addressOf(app)}/rooms/${room.room_id}/stream?token=${encodeURIComponent(agent.agent_token)}`);
    await waitForOpen(socket);

    await expect(app.close()).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
});
