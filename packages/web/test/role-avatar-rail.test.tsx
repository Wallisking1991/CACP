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

  it("shows delete badge for other members when owner", () => {
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

    const buttons = screen.queryAllByRole("button", { name: /remove/i });
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("does not show delete badge for self", () => {
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

    const aliceStack = screen.getByLabelText("Alice, Owner, online").closest(".role-avatar-stack") as HTMLElement;
    fireEvent.mouseEnter(aliceStack);

    const aliceBtn = aliceStack.querySelector(".role-avatar__delete");
    expect(aliceBtn).not.toBeInTheDocument();
  });

  it("does not show delete badge when not owner", () => {
    const onRemoveAvatar = vi.fn();
    render(
      <RoleAvatarRail
        avatars={avatars}
        maxVisible={6}
        isOwner={false}
        currentParticipantId="user_2"
        onRemoveAvatar={onRemoveAvatar}
      />
    );

    const aliceStack = screen.getByLabelText("Alice, Owner, online").closest(".role-avatar-stack") as HTMLElement;
    fireEvent.mouseEnter(aliceStack);

    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });

  it("renders agents before humans in the rail", () => {
    render(<RoleAvatarRail avatars={avatars} maxVisible={6} />);

    const rail = document.querySelector(".role-avatar-rail") as HTMLElement;
    const stacks = Array.from(rail.querySelectorAll(".role-avatar-stack"));
    const firstAgentIndex = stacks.findIndex((s) => s.querySelector('[aria-label*="Claude Code Agent"]'));
    const firstHumanIndex = stacks.findIndex((s) => s.querySelector('[aria-label*="Alice"]'));
    expect(firstAgentIndex).toBeLessThan(firstHumanIndex);
  });

  it("renders avatar names below initials", () => {
    render(<RoleAvatarRail avatars={avatars} maxVisible={6} />);

    const names = Array.from(document.querySelectorAll(".role-avatar__name"));
    expect(names.map((n) => n.textContent)).toEqual(["Claude Code Agent", "Bob", "Alice"]);
  });

  it("renders orbit bubble for matching avatar", () => {
    const bubbles = new Map([
      ["user_2", "Bob's orbit note"],
    ]);
    render(<RoleAvatarRail avatars={avatars} maxVisible={6} orbitBubbles={bubbles} />);

    expect(document.querySelector(".orbit-bubble")).toBeInTheDocument();
    expect(document.querySelector(".orbit-bubble__text")).toHaveTextContent("Bob's orbit note");
  });

  it("does not render orbit bubble when no match", () => {
    render(<RoleAvatarRail avatars={avatars} maxVisible={6} />);

    expect(document.querySelector(".orbit-bubble")).not.toBeInTheDocument();
  });
});
