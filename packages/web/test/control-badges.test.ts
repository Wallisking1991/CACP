import { describe, expect, it } from "vitest";
import { badgeChangesForCollapsedControls } from "../src/control-badges.js";

describe("control badges", () => {
  it("adds count deltas while controls are collapsed", () => {
    expect(badgeChangesForCollapsedControls({
      collapsed: true,
      previous: { agents: 1, invites: 0, participants: 1, flow: 0 },
      current: { agents: 2, invites: 1, participants: 2, flow: 1 },
      existing: { agent: 0, invite: 0, participants: 0, flow: 0 }
    })).toEqual({ agent: 1, invite: 1, participants: 1, flow: 1 });
  });

  it("resets badges when controls are expanded", () => {
    expect(badgeChangesForCollapsedControls({
      collapsed: false,
      previous: { agents: 1, invites: 0, participants: 1, flow: 0 },
      current: { agents: 2, invites: 1, participants: 2, flow: 1 },
      existing: { agent: 3, invite: 2, participants: 1, flow: 4 }
    })).toEqual({ agent: 0, invite: 0, participants: 0, flow: 0 });
  });
});
