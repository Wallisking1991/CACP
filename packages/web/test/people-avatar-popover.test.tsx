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

    const selects = screen.getAllByLabelText(/change role/i);
    expect(selects.length).toBeGreaterThan(0);

    fireEvent.change(selects[0], { target: { value: "admin" } });
    // Should NOT call onUpdateRole immediately; confirmation dialog should appear
    expect(onUpdateRole).not.toHaveBeenCalled();

    // Confirm the role change in the dialog
    const confirmBtn = screen.getByRole("button", { name: /Confirm/i });
    fireEvent.click(confirmBtn);
    expect(onUpdateRole).toHaveBeenCalledWith("user_2", "admin");
  });

  it("cancels role change when user clicks cancel in the dialog", () => {
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

    const selects = screen.getAllByLabelText(/change role/i);
    fireEvent.change(selects[0], { target: { value: "observer" } });
    expect(onUpdateRole).not.toHaveBeenCalled();

    const cancelBtn = screen.getByRole("button", { name: /Cancel/i });
    fireEvent.click(cancelBtn);
    expect(onUpdateRole).not.toHaveBeenCalled();
  });

  it("cancels role change when user presses Escape in the dialog", () => {
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

    const selects = screen.getAllByLabelText(/change role/i);
    fireEvent.change(selects[0], { target: { value: "observer" } });
    expect(onUpdateRole).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onUpdateRole).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Confirm/i })).not.toBeInTheDocument();
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

    expect(screen.queryByLabelText(/change role/i)).not.toBeInTheDocument();
  });

  it("does not show role dropdown for owner themselves", () => {
    render(
      <LangProvider>
        <PeopleAvatarPopover
          participants={participants}
          isOwner={true}
          currentParticipantId="user_1"
          onUpdateRole={vi.fn()}
        />
      </LangProvider>
    );

    // Alice (owner, user_1) should not have a dropdown; Bob, Charlie, Dave should.
    const selects = screen.getAllByLabelText(/change role/i);
    expect(selects).toHaveLength(3);
    // Ensure none of the selects belong to Alice by checking values
    for (const select of selects) {
      expect(select).not.toHaveValue("owner");
    }
  });

  it("does not show role dropdown for any owner participant", () => {
    const multiOwnerParticipants = [
      { id: "user_1", display_name: "Alice", role: "owner" as const },
      { id: "user_5", display_name: "Eve", role: "owner" as const },
      { id: "user_2", display_name: "Bob", role: "member" as const },
    ];
    render(
      <LangProvider>
        <PeopleAvatarPopover
          participants={multiOwnerParticipants}
          isOwner={true}
          currentParticipantId="user_1"
          onUpdateRole={vi.fn()}
        />
      </LangProvider>
    );

    // Only Bob (member) should have a dropdown; both owners should not.
    const selects = screen.getAllByLabelText(/change role/i);
    expect(selects).toHaveLength(1);
  });
});
