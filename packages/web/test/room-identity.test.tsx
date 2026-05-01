import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { LangProvider } from "../src/i18n/LangProvider.js";
import { RoomIdentity } from "../src/components/RoomIdentity.js";

describe("RoomIdentity", () => {
  it("shows compact room identity and copies the full room id", () => {
    const onCopyRoomId = vi.fn();
    render(
      <LangProvider>
        <RoomIdentity roomName="CACP AI Room" roomId="room_jPNCRNROwP3_isiArOvncw" userDisplayName="Wei" userRole="owner" isOwner={true} onCopyRoomId={onCopyRoomId} />
      </LangProvider>
    );

    expect(screen.getByText("CACP AI Room")).toBeInTheDocument();
    expect(screen.getByText("Wei · Owner")).toBeInTheDocument();
    expect(screen.getByText("room_jPNC…Ovncw")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Copy room ID/i }));
    expect(onCopyRoomId).toHaveBeenCalledWith("room_jPNCRNROwP3_isiArOvncw");
  });

  it("shows invite panel with maxUses selector", () => {
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

    fireEvent.click(screen.getByRole("button", { name: /Create room invite/i }));
    expect(screen.getByLabelText(/Invite size/i)).toBeInTheDocument();
  });

  it("shows created invite and active invites", () => {
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

    fireEvent.click(screen.getByRole("button", { name: /Create room invite/i }));
    expect(screen.getByText(/member — 3\/5 left/i)).toBeInTheDocument();
  });
});
