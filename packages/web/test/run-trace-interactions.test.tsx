import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveAgentRunApproval, resolveAgentRunElicitation } from "../src/api.js";

describe("run trace interaction API", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockJsonResponse(body: unknown): void {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => body
    } as Response);
  }

  it("posts approval resolution decisions", async () => {
    mockJsonResponse({ ok: true, decision: "allow" });

    await expect(resolveAgentRunApproval({
      serverUrl: "http://server",
      roomId: "room_1",
      token: "owner_secret",
      runId: "turn_1",
      nodeId: "approval_1",
      decision: "allow"
    })).resolves.toEqual({ ok: true, decision: "allow" });

    expect(fetch).toHaveBeenCalledWith("http://server/rooms/room_1/agent-runs/turn_1/approvals/approval_1/resolve", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner_secret" },
      body: JSON.stringify({ decision: "allow" })
    });
  });

  it("posts elicitation resolution actions", async () => {
    mockJsonResponse({ ok: true, action: "decline" });

    await expect(resolveAgentRunElicitation({
      serverUrl: "http://server",
      roomId: "room_1",
      token: "owner_secret",
      runId: "turn_1",
      nodeId: "elicitation_1",
      action: "decline"
    })).resolves.toEqual({ ok: true, action: "decline" });

    expect(fetch).toHaveBeenCalledWith("http://server/rooms/room_1/agent-runs/turn_1/elicitations/elicitation_1/resolve", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer owner_secret" },
      body: JSON.stringify({ action: "decline" })
    });
  });
});
