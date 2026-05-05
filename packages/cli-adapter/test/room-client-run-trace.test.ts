import { describe, expect, it, vi } from "vitest";
import { RoomClient } from "../src/room-client.js";

function createClient() {
  return new RoomClient({ serverUrl: "http://127.0.0.1:3737", roomId: "room_1", agentToken: "token_1" });
}

describe("RoomClient run-trace methods", () => {
  it("posts run lifecycle events to the new routes", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const client = createClient();

    try {
      await client.startRun("turn_1", {
        run_id: "turn_1",
        turn_id: "turn_1",
        agent_id: "agent_1",
        provider: "claude-code",
        started_at: "2026-05-05T00:00:00.000Z"
      });

      await client.completeRun("turn_1", {
        run_id: "turn_1",
        turn_id: "turn_1",
        agent_id: "agent_1",
        provider: "claude-code",
        message_id: "msg_1",
        summary: "Completed",
        metrics: { files_read: 2, searches: 1, commands: 3 },
        completed_at: "2026-05-05T00:00:05.000Z"
      });

      await client.failRun("turn_1", {
        run_id: "turn_1",
        turn_id: "turn_1",
        agent_id: "agent_1",
        provider: "claude-code",
        error: "Run failed",
        failed_at: "2026-05-05T00:00:06.000Z"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:3737/rooms/room_1/agent-runs/turn_1/start",
      expect.objectContaining({ method: "POST", body: expect.stringContaining("\"started_at\"") })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:3737/rooms/room_1/agent-runs/turn_1/complete",
      expect.objectContaining({ method: "POST", body: expect.stringContaining("\"metrics\"") })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:3737/rooms/room_1/agent-runs/turn_1/fail",
      expect.objectContaining({ method: "POST", body: expect.stringContaining("Run failed") })
    );
  });

  it("posts run node events to the new routes", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const client = createClient();

    try {
      await client.startRunNode("turn_1", {
        run_id: "turn_1",
        turn_id: "turn_1",
        agent_id: "agent_1",
        provider: "codex-cli",
        node_id: "node_1",
        kind: "tool",
        status: "running",
        title: "Run Bash",
        started_at: "2026-05-05T00:00:00.000Z",
        updated_at: "2026-05-05T00:00:00.000Z"
      });

      await client.appendRunNodeDelta("turn_1", "node_1", {
        run_id: "turn_1",
        turn_id: "turn_1",
        agent_id: "agent_1",
        provider: "codex-cli",
        node_id: "node_1",
        delta_type: "stdout",
        chunk: "hello",
        updated_at: "2026-05-05T00:00:01.000Z"
      });

      await client.updateRunNode("turn_1", "node_1", {
        run_id: "turn_1",
        turn_id: "turn_1",
        agent_id: "agent_1",
        provider: "codex-cli",
        node_id: "node_1",
        status: "streaming",
        title: "Still running",
        updated_at: "2026-05-05T00:00:02.000Z"
      });

      await client.completeRunNode("turn_1", "node_1", {
        run_id: "turn_1",
        turn_id: "turn_1",
        agent_id: "agent_1",
        provider: "codex-cli",
        node_id: "node_1",
        summary: "Done",
        completed_at: "2026-05-05T00:00:03.000Z"
      });

      await client.failRunNode("turn_1", "node_1", {
        run_id: "turn_1",
        turn_id: "turn_1",
        agent_id: "agent_1",
        provider: "codex-cli",
        node_id: "node_1",
        error: "Node failed",
        failed_at: "2026-05-05T00:00:04.000Z"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:3737/rooms/room_1/agent-runs/turn_1/nodes/start",
      expect.objectContaining({ method: "POST", body: expect.stringContaining("\"node_id\":\"node_1\"") })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:3737/rooms/room_1/agent-runs/turn_1/nodes/node_1/delta",
      expect.objectContaining({ method: "POST", body: expect.stringContaining("\"chunk\":\"hello\"") })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:3737/rooms/room_1/agent-runs/turn_1/nodes/node_1/update",
      expect.objectContaining({ method: "POST", body: expect.stringContaining("\"status\":\"streaming\"") })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:3737/rooms/room_1/agent-runs/turn_1/nodes/node_1/complete",
      expect.objectContaining({ method: "POST", body: expect.stringContaining("\"summary\":\"Done\"") })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "http://127.0.0.1:3737/rooms/room_1/agent-runs/turn_1/nodes/node_1/fail",
      expect.objectContaining({ method: "POST", body: expect.stringContaining("Node failed") })
    );
  });

  it("posts approval requests to the blocking approval endpoint", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      decision: "allow",
      resolved_by: "user_1",
      resolved_at: "2026-05-05T00:00:01.000Z"
    }), { status: 201 })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const client = createClient();

    let response: Awaited<ReturnType<RoomClient["requestRunApproval"]>>;
    try {
      response = await client.requestRunApproval("turn_1", "approval_1", {
        agent_id: "agent_1",
        turn_id: "turn_1",
        tool_node_id: "toolu_1",
        tool_use_id: "toolu_1",
        tool_name: "Bash",
        requested_at: "2026-05-05T00:00:00.000Z"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(response!.decision).toBe("allow");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3737/rooms/room_1/agent-runs/turn_1/approvals/approval_1/request",
      expect.objectContaining({ method: "POST", body: expect.stringContaining("\"tool_name\":\"Bash\"") })
    );
  });

  it("posts elicitation requests to the blocking elicitation endpoint", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      action: "accept",
      content: { answer: "yes" },
      resolved_by: "user_1",
      resolved_at: "2026-05-05T00:00:02.000Z"
    }), { status: 201 })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const client = createClient();

    let response: Awaited<ReturnType<RoomClient["requestRunElicitation"]>>;
    try {
      response = await client.requestRunElicitation("turn_1", "elicitation_1", {
        agent_id: "agent_1",
        turn_id: "turn_1",
        message: "Need confirmation",
        requested_at: "2026-05-05T00:00:00.000Z"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(response!.action).toBe("accept");
    expect(response!.content).toEqual({ answer: "yes" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3737/rooms/room_1/agent-runs/turn_1/elicitations/elicitation_1/request",
      expect.objectContaining({ method: "POST", body: expect.stringContaining("Need confirmation") })
    );
  });
});
