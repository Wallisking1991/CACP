import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

    expect(screen.getByLabelText("Bob, Member, typing")).toBeInTheDocument();
    expect(screen.getByLabelText("Claude Code Agent, AI, working")).toBeInTheDocument();
    expect(screen.getByText("Humans")).toBeInTheDocument();
    expect(screen.getByText("Agents")).toBeInTheDocument();
  });

  it("folds inactive overflow into a count", () => {
    render(<RoleAvatarRail avatars={[...avatars, ...avatars.map((item, index) => ({ ...item, id: `${item.id}_${index}`, active: false, status: "idle" as const }))]} maxVisible={3} />);
    expect(screen.getByText(/\+3/)).toBeInTheDocument();
  });

  it("calls onClickHumanAvatar when a human avatar is clicked", () => {
    const onClickHumanAvatar = vi.fn();
    render(
      <RoleAvatarRail
        avatars={avatars}
        maxVisible={6}
        onClickHumanAvatar={onClickHumanAvatar}
      />
    );

    const bobStack = screen.getByLabelText("Bob, Member, typing").closest(".role-avatar-stack") as HTMLElement;
    fireEvent.click(bobStack);

    expect(onClickHumanAvatar).toHaveBeenCalled();
  });

  it("calls onClickAgentAvatar when an agent avatar is clicked", () => {
    const onClickAgentAvatar = vi.fn();
    render(
      <RoleAvatarRail
        avatars={avatars}
        maxVisible={6}
        onClickAgentAvatar={onClickAgentAvatar}
      />
    );

    const agentStack = screen.getByLabelText("Claude Code Agent, AI, working").closest(".role-avatar-stack") as HTMLElement;
    fireEvent.click(agentStack);

    expect(onClickAgentAvatar).toHaveBeenCalled();
  });

  it("does not show hover delete badge", () => {
    const onRemoveAvatar = vi.fn();
    render(
      <RoleAvatarRail
        avatars={avatars}
        maxVisible={6}
        isOwner={true}
        currentParticipantId="user_1"
        onRemoveAvatar={onRemoveAvatar}
      />
    );

    const bobStack = screen.getByLabelText("Bob, Member, typing").closest(".role-avatar-stack") as HTMLElement;
    fireEvent.mouseEnter(bobStack);

    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });
});
