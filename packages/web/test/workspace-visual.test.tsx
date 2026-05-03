import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Workspace from "../src/components/Workspace.js";

describe("Workspace visual atmosphere", () => {
  it("renders workspace shell with two orb elements", () => {
    render(
      <Workspace
        session={{
          room_id: "room-1",
          token: "tok",
          participant_id: "p1",
          role: "owner",
          display_name: "Test",
        }}
        events={[]}
        onLeaveRoom={() => {}}
        onSendMessage={() => {}}
        onSelectAgent={() => {}}
        onCreateInvite={async () => undefined}
        onApproveJoinRequest={() => {}}
        onRejectJoinRequest={() => {}}
        onRemoveParticipant={() => {}}
      />
    );

    const shell = document.querySelector(".workspace-shell");
    expect(shell).not.toBeNull();

    const orbs = shell!.querySelectorAll(".workspace-orb");
    expect(orbs.length).toBe(2);
  });
});
