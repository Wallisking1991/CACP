import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { LangProvider } from "../src/i18n/LangProvider.js";
import { PeopleAvatarPopover } from "../src/components/PeopleAvatarPopover.js";

const participants = [
  { id: "user_1", display_name: "Alice", role: "owner" as const },
  { id: "user_2", display_name: "Bob", role: "member" as const },
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

  it("does not show remove buttons when not owner", () => {
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
});
