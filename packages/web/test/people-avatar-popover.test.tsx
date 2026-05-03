import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { LangProvider } from "../src/i18n/LangProvider.js";
import { PeopleAvatarPopover } from "../src/components/PeopleAvatarPopover.js";

const participants = [
  { id: "user_1", display_name: "Alice", role: "owner" as const },
  { id: "user_2", display_name: "Bob", role: "member" as const },
  { id: "user_3", display_name: "Charlie", role: "admin" as const },
  { id: "user_4", display_name: "Dave", role: "observer" as const },
];

describe("PeopleAvatarPopover", () => {
  it("renders participant list with names and roles", () => {
    render(
      <LangProvider>
        <PeopleAvatarPopover participants={participants} isOwner={false} currentParticipantId="user_1" />
      </LangProvider>
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    expect(screen.getByText("Dave")).toBeInTheDocument();
  });

  it("shows remove buttons for non-owner participants when user is owner", () => {
    const onRemoveParticipant = vi.fn();
    render(
      <LangProvider>
        <PeopleAvatarPopover
          participants={participants}
          isOwner={true}
          currentParticipantId="user_1"
          onRemoveParticipant={onRemoveParticipant}
        />
      </LangProvider>
    );

    const removeBtn = screen.getByRole("button", { name: /remove Bob/i });
    expect(removeBtn).toBeInTheDocument();

    fireEvent.click(removeBtn);
    expect(onRemoveParticipant).toHaveBeenCalledWith("user_2");
  });

  it("does not show remove button for owner themselves", () => {
    render(
      <LangProvider>
        <PeopleAvatarPopover
          participants={participants}
          isOwner={true}
          currentParticipantId="user_1"
          onRemoveParticipant={vi.fn()}
        />
      </LangProvider>
    );

    expect(screen.queryByRole("button", { name: /remove Alice/i })).not.toBeInTheDocument();
  });

  it("does not show remove buttons when not owner and not admin", () => {
    render(
      <LangProvider>
        <PeopleAvatarPopover
          participants={participants}
          isOwner={false}
          currentParticipantId="user_2"
          onRemoveParticipant={vi.fn()}
        />
      </LangProvider>
    );

    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });

  it("lets admin remove members and observers but not owner or other admins", () => {
    const onRemoveParticipant = vi.fn();
    render(
      <LangProvider>
        <PeopleAvatarPopover
          participants={participants}
          isOwner={false}
          canRemoveParticipants={true}
          currentParticipantId="user_3"
          onRemoveParticipant={onRemoveParticipant}
        />
      </LangProvider>
    );

    // Admin can remove member (Bob)
    expect(screen.getByRole("button", { name: /remove Bob/i })).toBeInTheDocument();
    // Admin can remove observer (Dave)
    expect(screen.getByRole("button", { name: /remove Dave/i })).toBeInTheDocument();
    // Admin cannot remove owner (Alice)
    expect(screen.queryByRole("button", { name: /remove Alice/i })).not.toBeInTheDocument();
    // Admin cannot remove other admin (Charlie - self)
    expect(screen.queryByRole("button", { name: /remove Charlie/i })).not.toBeInTheDocument();
  });

  it("shows role dropdown only for owner", () => {
    const onUpdateRole = vi.fn();
    render(
      <LangProvider>
        <PeopleAvatarPopover
          participants={participants}
          isOwner={true}
          currentParticipantId="user_1"
          onUpdateRole={onUpdateRole}
        />
      </LangProvider>
    );

    const selects = screen.getAllByLabelText(/changeRole/i);
    expect(selects.length).toBeGreaterThan(0);

    fireEvent.change(selects[0], { target: { value: "admin" } });
    expect(onUpdateRole).toHaveBeenCalledWith("user_2", "admin");
  });

  it("does not show role dropdown for admin", () => {
    render(
      <LangProvider>
        <PeopleAvatarPopover
          participants={participants}
          isOwner={false}
          canRemoveParticipants={true}
          currentParticipantId="user_3"
          onUpdateRole={vi.fn()}
        />
      </LangProvider>
    );

    expect(screen.queryByLabelText(/changeRole/i)).not.toBeInTheDocument();
  });
});
