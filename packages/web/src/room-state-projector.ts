import {
  deriveRoomState,
  type AvatarStatusKind,
  type DeriveRoomStateOptions,
  type RoomStateEvent,
  type RoomViewState,
} from "./room-state.js";

export type { RoomStateEvent } from "./room-state.js";

export interface RoomStateProjector {
  project(
    events: readonly RoomStateEvent[],
    options?: DeriveRoomStateOptions
  ): RoomViewState;
}

function sameEventPrefix(
  previous: readonly RoomStateEvent[],
  next: readonly RoomStateEvent[]
): boolean {
  if (previous.length > next.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) return false;
  }
  return true;
}

function canAppendWithoutReplay(
  state: RoomViewState,
  events: readonly RoomStateEvent[]
): boolean {
  if ([...state.participantActivity.values()].some((entry) => entry.typing)) {
    return false;
  }
  return events.every(
    (event) =>
      event.type === "agent.output.delta" ||
      event.type === "agent.run.node.delta"
  );
}

function appendAgentOutput(
  state: RoomViewState,
  event: RoomStateEvent
): RoomViewState {
  const turnId =
    typeof event.payload.turn_id === "string"
      ? event.payload.turn_id
      : undefined;
  const agentId =
    typeof event.payload.agent_id === "string"
      ? event.payload.agent_id
      : undefined;
  const chunk =
    typeof event.payload.chunk === "string" ? event.payload.chunk : undefined;
  if (!turnId || !agentId || chunk === undefined) return state;

  const runIndex = state.agentRuns.findIndex((run) => run.run_id === turnId);
  if (runIndex >= 0) {
    const agentRuns = [...state.agentRuns];
    const run = agentRuns[runIndex];
    agentRuns[runIndex] = {
      ...run,
      answer_text: `${run.answer_text ?? ""}${chunk}`,
    };
    return { ...state, agentRuns };
  }

  const turnIndex = state.streamingTurns.findIndex(
    (turn) => turn.turn_id === turnId
  );
  const streamingTurns = [...state.streamingTurns];
  if (turnIndex >= 0) {
    const turn = streamingTurns[turnIndex];
    streamingTurns[turnIndex] = { ...turn, text: turn.text + chunk };
  } else {
    streamingTurns.push({ turn_id: turnId, agent_id: agentId, text: chunk });
  }

  const avatarStatuses = state.avatarStatuses
    .map((avatar) =>
      avatar.id === agentId
        ? { ...avatar, status: "working" as const, active: true }
        : avatar
    )
    .sort(
      (left, right) =>
        avatarPriority(left.status) - avatarPriority(right.status) ||
        left.display_name.localeCompare(right.display_name)
    );
  return { ...state, streamingTurns, avatarStatuses };
}

function avatarPriority(status: AvatarStatusKind): number {
  switch (status) {
    case "working":
      return 0;
    case "typing":
      return 1;
    case "online":
      return 2;
    case "idle":
      return 3;
    case "offline":
      return 4;
  }
}

function appendAgentRunNodeOutput(
  state: RoomViewState,
  event: RoomStateEvent
): RoomViewState {
  const runId =
    typeof event.payload.run_id === "string" ? event.payload.run_id : undefined;
  const nodeId =
    typeof event.payload.node_id === "string"
      ? event.payload.node_id
      : undefined;
  const chunk =
    typeof event.payload.chunk === "string" ? event.payload.chunk : undefined;
  const deltaType =
    typeof event.payload.delta_type === "string"
      ? event.payload.delta_type
      : undefined;
  if (!runId || !nodeId || chunk === undefined) return state;

  const runIndex = state.agentRuns.findIndex((run) => run.run_id === runId);
  if (runIndex < 0) return state;
  const run = state.agentRuns[runIndex];
  const nodeIndex = run.nodes.findIndex((node) => node.node_id === nodeId);
  if (nodeIndex < 0) return state;

  const nodes = [...run.nodes];
  const node = nodes[nodeIndex];
  nodes[nodeIndex] = {
    ...node,
    ...(deltaType === "stdout"
      ? { stdout_chunks: [...node.stdout_chunks, chunk] }
      : deltaType === "stderr"
        ? { stderr_chunks: [...node.stderr_chunks, chunk] }
        : { text_chunks: [...node.text_chunks, chunk] }),
    updated_at:
      typeof event.payload.updated_at === "string"
        ? event.payload.updated_at
        : event.created_at,
  };
  const agentRuns = [...state.agentRuns];
  agentRuns[runIndex] = { ...run, nodes };
  return { ...state, agentRuns };
}

function appendProjectedEvent(
  state: RoomViewState,
  event: RoomStateEvent
): RoomViewState {
  switch (event.type) {
    case "agent.output.delta":
      return appendAgentOutput(state, event);
    case "agent.run.node.delta":
      return appendAgentRunNodeOutput(state, event);
    default:
      return state;
  }
}

export function createRoomStateProjector(): RoomStateProjector {
  let previousEvents: readonly RoomStateEvent[] = [];
  let previousState: RoomViewState | undefined;
  let previousParticipantId: string | undefined;
  let previousTypingTtlMs: number | undefined;
  let previousNow: string | undefined;

  return {
    project(events, options = {}) {
      if (
        events === previousEvents &&
        previousState &&
        previousParticipantId === options.currentParticipantId &&
        previousTypingTtlMs === options.typingTtlMs &&
        previousNow === options.now
      ) {
        return previousState;
      }

      const appendedEvents = events.slice(previousEvents.length);
      const canAppend =
        previousState !== undefined &&
        previousParticipantId === options.currentParticipantId &&
        previousTypingTtlMs === options.typingTtlMs &&
        sameEventPrefix(previousEvents, events) &&
        canAppendWithoutReplay(previousState, appendedEvents);

      const state =
        canAppend && previousState
          ? appendedEvents.reduce<RoomViewState>(
              appendProjectedEvent,
              previousState
            )
          : deriveRoomState([...events], options);

      previousEvents = events;
      previousState = state;
      previousParticipantId = options.currentParticipantId;
      previousTypingTtlMs = options.typingTtlMs;
      previousNow = options.now;
      return state;
    },
  };
}
