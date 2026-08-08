import { describe, expect, it } from "vitest";
import {
  createRoomStateProjector,
  type RoomStateEvent,
} from "../src/room-state-projector.js";
import { deriveRoomState } from "../src/room-state.js";

function event(
  type: RoomStateEvent["type"],
  payload: Record<string, unknown>,
  sequence: number,
  actorId = "user_1"
): RoomStateEvent {
  return {
    protocol: "cacp",
    version: "0.3.0",
    event_id: `evt_${sequence}`,
    room_id: "room_1",
    type,
    actor_id: actorId,
    created_at: `2026-04-25T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload,
  };
}

describe("room state projector", () => {
  it("appends streamed output without reading historical events again", () => {
    const historicalEvents = [
      event(
        "participant.joined",
        {
          participant: {
            id: "user_1",
            display_name: "Alice",
            role: "owner",
            type: "human",
          },
        },
        1
      ),
      event(
        "agent.registered",
        {
          agent_id: "agent_1",
          name: "Claude Code Agent",
          capabilities: ["repo.read"],
        },
        2,
        "agent_1"
      ),
      event("room.agent_selected", { agent_id: "agent_1" }, 3),
      event(
        "agent.turn.started",
        { turn_id: "turn_1", agent_id: "agent_1" },
        4,
        "agent_1"
      ),
      event(
        "agent.output.delta",
        { turn_id: "turn_1", agent_id: "agent_1", chunk: "Hello" },
        5,
        "agent_1"
      ),
    ];
    let historyLocked = false;
    const guardedHistory = historicalEvents.map((historicalEvent) => {
      const guarded = { ...historicalEvent };
      Object.defineProperty(guarded, "type", {
        enumerable: true,
        get() {
          if (historyLocked) throw new Error("historical event was replayed");
          return historicalEvent.type;
        },
      });
      return guarded;
    });
    const projector = createRoomStateProjector();

    projector.project(guardedHistory);
    historyLocked = true;
    const state = projector.project([
      ...guardedHistory,
      event(
        "agent.output.delta",
        { turn_id: "turn_1", agent_id: "agent_1", chunk: " world" },
        6,
        "agent_1"
      ),
    ]);

    expect(state.streamingTurns).toEqual([
      {
        turn_id: "turn_1",
        agent_id: "agent_1",
        text: "Hello world",
      },
    ]);
  });

  it("appends Agent run node output without replaying the run history", () => {
    const historicalEvents = [
      event(
        "agent.run.started",
        {
          run_id: "run_1",
          turn_id: "turn_1",
          agent_id: "agent_1",
          provider: "claude-code",
          started_at: "2026-04-25T00:00:01.000Z",
        },
        1,
        "agent_1"
      ),
      event(
        "agent.run.node.started",
        {
          run_id: "run_1",
          turn_id: "turn_1",
          agent_id: "agent_1",
          provider: "claude-code",
          node_id: "node_1",
          kind: "tool",
          status: "running",
          title: "Run command",
        },
        2,
        "agent_1"
      ),
      event(
        "agent.run.node.delta",
        {
          run_id: "run_1",
          node_id: "node_1",
          delta_type: "text",
          chunk: "first",
        },
        3,
        "agent_1"
      ),
    ];
    let historyLocked = false;
    const guardedHistory = historicalEvents.map((historicalEvent) => {
      const guarded = { ...historicalEvent };
      Object.defineProperty(guarded, "type", {
        enumerable: true,
        get() {
          if (historyLocked) throw new Error("run history was replayed");
          return historicalEvent.type;
        },
      });
      return guarded;
    });
    const projector = createRoomStateProjector();

    projector.project(guardedHistory);
    historyLocked = true;
    const state = projector.project([
      ...guardedHistory,
      event(
        "agent.run.node.delta",
        {
          run_id: "run_1",
          node_id: "node_1",
          delta_type: "text",
          chunk: " second",
        },
        4,
        "agent_1"
      ),
    ]);

    expect(state.agentRuns[0]?.nodes[0]?.text_chunks).toEqual([
      "first",
      " second",
    ]);
  });

  it("matches a full derivation when output starts an implicit turn", () => {
    const history = [
      event(
        "agent.registered",
        { agent_id: "agent_1", name: "Zulu", capabilities: [] },
        1,
        "agent_1"
      ),
      event(
        "agent.registered",
        { agent_id: "agent_2", name: "Alpha", capabilities: [] },
        2,
        "agent_2"
      ),
      event("room.agent_selected", { agent_id: "agent_2" }, 3),
    ];
    const delta = event(
      "agent.output.delta",
      { turn_id: "turn_1", agent_id: "agent_1", chunk: "Hello" },
      4,
      "agent_1"
    );
    const projector = createRoomStateProjector();
    projector.project(history);

    const projected = projector.project([...history, delta]);

    expect(projected).toEqual(deriveRoomState([...history, delta]));
  });

  it("re-evaluates typing expiry when time advances", () => {
    const history = [
      event(
        "participant.joined",
        {
          participant: {
            id: "user_1",
            display_name: "Alice",
            role: "owner",
            type: "human",
          },
        },
        1
      ),
      event(
        "participant.typing_started",
        {
          participant_id: "user_1",
          scope: "room",
          started_at: "2026-04-25T00:00:02.000Z",
        },
        2
      ),
    ];
    const projector = createRoomStateProjector();

    expect(
      projector
        .project(history, {
          now: "2026-04-25T00:00:03.000Z",
          typingTtlMs: 5_000,
        })
        .participantActivity.get("user_1")?.typing
    ).toBe(true);
    expect(
      projector
        .project(history, {
          now: "2026-04-25T00:00:10.000Z",
          typingTtlMs: 5_000,
        })
        .participantActivity.get("user_1")?.typing
    ).toBe(false);
  });
});
