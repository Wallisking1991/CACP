import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { RoleAvatarRail } from "../src/components/RoleAvatarRail.js";
import type { AvatarStatusView } from "../src/room-state.js";

const avatars: AvatarStatusView[] = [
  { id: "user_1", display_name: "Alice", role: "owner", kind: "human", group: "humans", status: "online", active: false },
  { id: "user_2", display_name: "Bob", role: "member", kind: "human", group: "humans", status: "typing", active: true },
  { id: "agent_1", display_name: "Claude Code Agent", role: "agent", kind: "agent", group: "agents", status: "working", capabilities: ["repo.read"], active: true }
];

describe("RoleAvatarRail", () => {
  it("renders grouped avatars with accessible status labels", () => {
    render(<RoleAvatarRail avatars={avatars} maxVisible={6} />);

    expect(screen.getByLabelText("Bob, member, typing")).toBeInTheDocument();
    expect(screen.getByLabelText("Claude Code Agent, AI agent, working")).toBeInTheDocument();
    expect(screen.getByText("Humans")).toBeInTheDocument();
    expect(screen.getByText("Agents")).toBeInTheDocument();
  });

  it("folds inactive overflow into a count", () => {
    render(<RoleAvatarRail avatars={[...avatars, ...avatars.map((item, index) => ({ ...item, id: `${item.id}_${index}`, active: false, status: "idle" as const }))]} maxVisible={3} />);
    expect(screen.getByText(/\+3/)).toBeInTheDocument();
  });
});
