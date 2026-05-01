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

  describe("owner delete badge", () => {
    it("shows a delete badge when owner hovers over another participant's avatar", () => {
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

      const deleteBtn = screen.getByRole("button", { name: /remove Bob/i });
      expect(deleteBtn).toBeInTheDocument();
    });

    it("does not show delete badge when non-owner hovers", () => {
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

    it("does not show delete badge on owner's own avatar", () => {
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

      expect(screen.queryByRole("button", { name: /remove Alice/i })).not.toBeInTheDocument();
    });

    it("calls onRemoveAvatar with the correct id when delete badge is clicked", () => {
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

      const deleteBtn = screen.getByRole("button", { name: /remove Bob/i });
      fireEvent.click(deleteBtn);

      expect(onRemoveAvatar).toHaveBeenCalledWith("user_2");
    });

    it("shows delete badge on agent avatars for owner", () => {
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

      const agentStack = screen.getByLabelText("Claude Code Agent, AI, working").closest(".role-avatar-stack") as HTMLElement;
      fireEvent.mouseEnter(agentStack);

      const deleteBtn = screen.getByRole("button", { name: /remove Claude Code Agent/i });
      expect(deleteBtn).toBeInTheDocument();
    });
  });
});
