import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { LangProvider } from "../src/i18n/LangProvider.js";
import { RoomIdentity } from "../src/components/RoomIdentity.js";

describe("RoomIdentity", () => {
  it("shows room name and user identity line", () => {
    render(
      <LangProvider>
        <RoomIdentity
          roomName="CACP AI Room"
          roomId="room_jPNCRNROwP3_isiArOvncw"
          userDisplayName="Wei"
          userRole="owner"
          isOwner={true}
          onCopyRoomId={vi.fn()}
        />
      </LangProvider>
    );

    expect(screen.getByText("CACP AI Room")).toBeInTheDocument();
    expect(screen.getByText("Wei · Owner")).toBeInTheDocument();
    expect(document.querySelector(".room-identity-avatar")).not.toBeInTheDocument();
    expect(document.querySelector(".role-badge")).not.toBeInTheDocument();
  });

  it("does not render avatar or role badge", () => {
    render(
      <LangProvider>
        <RoomIdentity
          roomName="Test Room"
          roomId="room_1"
          userDisplayName="John Doe"
          userRole="member"
          isOwner={false}
          onCopyRoomId={vi.fn()}
        />
      </LangProvider>
    );

    expect(screen.getByText("John Doe · Member")).toBeInTheDocument();
    expect(document.querySelector(".room-identity-avatar")).not.toBeInTheDocument();
    expect(document.querySelector(".role-badge")).not.toBeInTheDocument();
  });

  it("share menu shows invite and pairing options for owner", () => {
    render(
      <LangProvider>
        <RoomIdentity
          roomName="Test Room"
          roomId="room_1"
          userDisplayName="Wei"
          userRole="owner"
          isOwner={true}
          onCopyRoomId={vi.fn()}
          onCreateInvite={vi.fn(async () => "http://localhost/invite")}
          onCreatePairing={vi.fn(async () => "code123")}
        />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Share/i }));
    expect(screen.getByRole("button", { name: /Create room invite/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy room connection code/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy room ID/i })).not.toBeInTheDocument();
  });

  it("does not show share button for non-owner", () => {
    render(
      <LangProvider>
        <RoomIdentity
          roomName="Test Room"
          roomId="room_1"
          userDisplayName="Wei"
          userRole="member"
          isOwner={false}
          onCopyRoomId={vi.fn()}
        />
      </LangProvider>
    );

    expect(screen.queryByRole("button", { name: /Share/i })).not.toBeInTheDocument();
  });

  it("shows invite panel with maxUses selector via share menu", () => {
    render(
      <LangProvider>
        <RoomIdentity
          roomName="Test"
          roomId="room_1"
          isOwner={true}
          onCopyRoomId={vi.fn()}
          onCreateInvite={vi.fn(async () => "http://localhost/invite")}
        />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Share/i }));
    fireEvent.click(screen.getByRole("button", { name: /Create room invite/i }));
    expect(screen.getByLabelText(/Invite size/i)).toBeInTheDocument();
  });

  it("shows created invite and active invites via share menu", () => {
    render(
      <LangProvider>
        <RoomIdentity
          roomName="Test"
          roomId="room_1"
          isOwner={true}
          onCopyRoomId={vi.fn()}
          onCreateInvite={vi.fn(async () => "http://localhost/invite")}
          createdInvite={{ url: "http://localhost/invite?token=abc", role: "member", ttl: 3600, max_uses: 5 }}
          invites={[
            { invite_id: "inv_1", role: "member", expires_at: "2026-04-26T00:00:00.000Z", max_uses: 5, used_count: 2, remaining: 3, revoked: false }
          ]}
        />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /Share/i }));
    fireEvent.click(screen.getByRole("button", { name: /Create room invite/i }));
    expect(screen.getByText(/member — 3\/5 left/i)).toBeInTheDocument();
  });
});
