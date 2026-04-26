export interface ControlCounts {
  agents: number;
  invites: number;
  participants: number;
  flow: number;
}

export interface ControlBadges {
  agent: number;
  invite: number;
  participants: number;
  flow: number;
}

export function badgeChangesForCollapsedControls(input: {
  collapsed: boolean;
  previous: ControlCounts;
  current: ControlCounts;
  existing: ControlBadges;
}): ControlBadges {
  if (!input.collapsed) return zeroBadges();

  return {
    agent: input.existing.agent + positiveDelta(input.current.agents, input.previous.agents),
    invite: input.existing.invite + positiveDelta(input.current.invites, input.previous.invites),
    participants: input.existing.participants + positiveDelta(input.current.participants, input.previous.participants),
    flow: input.existing.flow + positiveDelta(input.current.flow, input.previous.flow)
  };
}

function positiveDelta(current: number, previous: number): number {
  return Math.max(0, current - previous);
}

function zeroBadges(): ControlBadges {
  return { agent: 0, invite: 0, participants: 0, flow: 0 };
}
