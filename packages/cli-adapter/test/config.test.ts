import { describe, expect, it, vi } from "vitest";
import { loadRuntimeConfigFromArgs, parseAdapterArgs } from "../src/config.js";

describe("adapter config arguments", () => {
  it("parses pairing mode arguments", () => {
    expect(parseAdapterArgs(["--server", "http://127.0.0.1:3737", "--pair", "cacp_pair"])).toEqual({ mode: "pair", server_url: "http://127.0.0.1:3737", pairing_token: "cacp_pair" });
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
});
