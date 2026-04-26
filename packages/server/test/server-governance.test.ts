import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

async function createRoom(default_policy: "owner_approval" | "majority" | "unanimous" = "majority") {
  const app = await buildServer({ dbPath: ":memory:" });
  const response = await app.inject({ method: "POST", url: "/rooms", payload: { name: "Governed Room", display_name: "Alice", default_policy } });
  expect(response.statusCode).toBe(201);
  const room = response.json() as { room_id: string; owner_token: string; owner_id: string };
  return { app, room, ownerAuth: { authorization: `Bearer ${room.owner_token}` } };
}

describe("CACP server pairing and governance", () => {
  it("creates expiring invite links and lets invited participants join by name", async () => {
    const { app, room, ownerAuth } = await createRoom();

    const invite = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: ownerAuth, payload: { role: "member", expires_in_seconds: 3600 } });
    expect(invite.statusCode).toBe(201);
    expect(invite.json().expires_at).toBeTruthy();

    const join = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/join`, payload: { invite_token: invite.json().invite_token, display_name: "Bob" } });
    expect(join.statusCode).toBe(201);
    expect(join.json().role).toBe("member");

    const expired = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/invites`, headers: ownerAuth, payload: { role: "observer", expires_in_seconds: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const expiredJoin = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/join`, payload: { invite_token: expired.json().invite_token, display_name: "Too Late" } });
    expect(expiredJoin.statusCode).toBe(401);
    expect(expiredJoin.json()).toEqual({ error: "invite_expired" });

    await app.close();
  });

  it("creates a pairing command and lets an adapter claim it as an online agent", async () => {
    const { app, room, ownerAuth } = await createRoom();

    const pairing = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-pairings`, headers: ownerAuth, payload: { agent_type: "claude-code", permission_level: "limited_write", working_dir: "D:\\Development\\2" } });
    expect(pairing.statusCode).toBe(201);
    expect(pairing.json().command).toContain("--pair");

    const claim = await app.inject({ method: "POST", url: `/agent-pairings/${pairing.json().pairing_token}/claim`, payload: { adapter_name: "Claude Local" } });
    expect(claim.statusCode).toBe(201);
    expect(claim.json().room_id).toBe(room.room_id);
    expect(claim.json().agent.name).toBe("Claude Code Agent");
    expect(claim.json().agent.capabilities).toContain("tool.approval");

    const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["agent.pairing_created", "agent.registered", "agent.status_changed"]));
    expect(events.find((event) => event.type === "agent.status_changed")?.payload.status).toBe("online");

    const secondClaim = await app.inject({ method: "POST", url: `/agent-pairings/${pairing.json().pairing_token}/claim`, payload: {} });
    expect(secondClaim.statusCode).toBe(409);

    await app.close();
  });

  it("closes blocking questions by room policy and emits action approval resolution", async () => {
    const { app, room, ownerAuth } = await createRoom("owner_approval");
    const agent = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agents/register`, headers: ownerAuth, payload: { name: "Claude", capabilities: [] } });
    const agentToken = agent.json().agent_token;

    const approval = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agent-action-approvals?token=${encodeURIComponent(agentToken)}`, payload: { tool_name: "Write", description: "Allow Write?" } });
    expect(approval.statusCode).toBe(201);

    const vote = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/questions/${approval.json().question_id}/responses`, headers: ownerAuth, payload: { response: "approve", comment: "ok" } });
    expect(vote.statusCode).toBe(201);
    expect(vote.json().closed).toBe(true);

    const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["question.created", "question.response_submitted", "question.closed", "agent.action_approval_resolved"]));
    expect(events.find((event) => event.type === "agent.action_approval_resolved")?.payload.decision).toBe("approve");

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
    expect(pairing.json().command).toContain("--server http://127.0.0.1:3737 ");
    expect(pairing.json().command).not.toContain("--server http://127.0.0.1:5173 ");

    await app.close();
  });

  it("can hold an action approval request until the room policy resolves it", async () => {
    const { app, room, ownerAuth } = await createRoom("owner_approval");
    const agent = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/agents/register`, headers: ownerAuth, payload: { name: "Claude", capabilities: [] } });
    const agentToken = agent.json().agent_token;

    const waitingApproval = app.inject({
      method: "POST",
      url: `/rooms/${room.room_id}/agent-action-approvals?token=${encodeURIComponent(agentToken)}&wait_ms=2000`,
      payload: { tool_name: "Write", description: "Allow Write?" }
    });

    let questionId: string | undefined;
    for (let attempt = 0; attempt < 20 && !questionId; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      const events = (await app.inject({ method: "GET", url: `/rooms/${room.room_id}/events`, headers: ownerAuth })).json().events as Array<{ type: string; payload: Record<string, unknown> }>;
      questionId = events.find((event) => event.type === "question.created" && event.payload.question_type === "agent_action_approval")?.payload.question_id as string | undefined;
    }
    expect(questionId).toBeTruthy();

    const vote = await app.inject({ method: "POST", url: `/rooms/${room.room_id}/questions/${questionId}/responses`, headers: ownerAuth, payload: { response: "approve", comment: "ok" } });
    expect(vote.statusCode).toBe(201);

    const approvalResult = await waitingApproval;
    expect(approvalResult.statusCode).toBe(201);
    expect(approvalResult.json()).toMatchObject({ status: "resolved", decision: "approve", question_id: questionId });

    await app.close();
  });
});
