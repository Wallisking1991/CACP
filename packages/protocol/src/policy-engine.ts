import type { Participant, ParticipantRole, Policy, VoteRecord } from "./schemas.js";

export type PolicyStatus = "pending" | "approved" | "rejected" | "expired";
export interface PolicyEvaluation {
  status: PolicyStatus;
  reason: string;
  approvals: number;
  rejections: number;
  eligible_voters: number;
}

function canVote(participant: Participant): boolean {
  return participant.role !== "observer" && participant.role !== "agent";
}

function latestVote(votes: VoteRecord[], participantId: string): VoteRecord | undefined {
  return [...votes].reverse().find((vote) => vote.voter_id === participantId);
}

function count(participants: Participant[], votes: VoteRecord[], roles?: ParticipantRole[]) {
  const eligible = participants.filter((participant) => canVote(participant) && (!roles || roles.includes(participant.role)));
  const latest = eligible.map((participant) => latestVote(votes, participant.id)).filter((vote): vote is VoteRecord => Boolean(vote));
  return {
    eligible,
    approvals: latest.filter((vote) => vote.vote === "approve").length,
    rejections: latest.filter((vote) => vote.vote === "reject").length
  };
}

export function evaluatePolicy(policy: Policy, participants: Participant[], votes: VoteRecord[], now = new Date()): PolicyEvaluation {
  if (policy.expires_at && new Date(policy.expires_at).getTime() <= now.getTime()) {
    return { status: "expired", reason: "policy expired", approvals: 0, rejections: 0, eligible_voters: participants.filter(canVote).length };
  }
  if (policy.type === "no_approval") {
    return { status: "approved", reason: "policy does not require approval", approvals: 0, rejections: 0, eligible_voters: participants.filter(canVote).length };
  }
  if (policy.type === "owner_approval") {
    const owners = participants.filter((participant) => participant.role === "owner");
    const result = count(owners, votes);
    if (result.approvals >= 1) return { status: "approved", reason: "owner approved", approvals: result.approvals, rejections: result.rejections, eligible_voters: owners.length };
    if (result.rejections >= 1) return { status: "rejected", reason: "owner rejected", approvals: result.approvals, rejections: result.rejections, eligible_voters: owners.length };
    return { status: "pending", reason: "waiting for owner approval", approvals: result.approvals, rejections: result.rejections, eligible_voters: owners.length };
  }
  if (policy.type === "majority") {
    const result = count(participants, votes);
    const required = Math.floor(result.eligible.length / 2) + 1;
    if (result.approvals >= required) return { status: "approved", reason: "majority approved", approvals: result.approvals, rejections: result.rejections, eligible_voters: result.eligible.length };
    if (result.rejections >= required) return { status: "rejected", reason: "majority rejected", approvals: result.approvals, rejections: result.rejections, eligible_voters: result.eligible.length };
    return { status: "pending", reason: `waiting for ${required} approvals`, approvals: result.approvals, rejections: result.rejections, eligible_voters: result.eligible.length };
  }
  if (policy.type === "role_quorum") {
    const result = count(participants, votes, policy.required_roles);
    if (result.approvals >= policy.min_approvals) return { status: "approved", reason: "role quorum reached", approvals: result.approvals, rejections: result.rejections, eligible_voters: result.eligible.length };
    return { status: "pending", reason: `waiting for ${policy.min_approvals} role approvals`, approvals: result.approvals, rejections: result.rejections, eligible_voters: result.eligible.length };
  }
  const result = count(participants, votes);
  if (result.rejections > 0) return { status: "rejected", reason: "unanimous policy received a rejection", approvals: result.approvals, rejections: result.rejections, eligible_voters: result.eligible.length };
  if (result.eligible.length > 0 && result.approvals === result.eligible.length) return { status: "approved", reason: "all eligible voters approved", approvals: result.approvals, rejections: result.rejections, eligible_voters: result.eligible.length };
  return { status: "pending", reason: "waiting for unanimous approval", approvals: result.approvals, rejections: result.rejections, eligible_voters: result.eligible.length };
}