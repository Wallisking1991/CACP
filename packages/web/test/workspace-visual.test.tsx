import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import Workspace from "../src/components/Workspace.js";

describe("Workspace visual atmosphere", () => {
  it("renders header with logo and glassmorphism classes", () => {
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

    const header = document.querySelector(".workspace-header");
    expect(header).not.toBeNull();

    const logo = header!.querySelector(".header-brand__logo");
    expect(logo).not.toBeNull();

    const svg = header!.querySelector("svg");
    expect(svg).not.toBeNull();
  });

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

  it("mounts without errors and major regions are present", () => {
    const { container } = render(
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

    expect(container.querySelector(".workspace-shell")).not.toBeNull();
    expect(container.querySelector(".workspace-header")).not.toBeNull();
    expect(container.querySelector(".thread")).not.toBeNull();
    expect(container.querySelector(".main-composer")).not.toBeNull();
  });
});
