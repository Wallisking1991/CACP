import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CacpEvent } from "@cacp/protocol";
import type { ComponentProps } from "react";
import { LangProvider } from "../src/i18n/LangProvider.js";
import Workspace from "../src/components/Workspace.js";
import type { RoomSession } from "../src/api.js";

// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

function event(type: CacpEvent["type"], payload: Record<string, unknown>, sequence: number, actor_id = "user_owner"): CacpEvent {
  return {
    protocol: "cacp",
    version: "0.2.0",
    event_id: `evt_${sequence}`,
    room_id: "room_1",
    type,
    actor_id,
    created_at: `2026-04-27T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload
  };
}

function renderWorkspace(role: RoomSession["role"], callbacks: Partial<ComponentProps<typeof Workspace>> = {}) {
  const session: RoomSession = {
    room_id: "room_1",
    token: "token_1",
    participant_id: "user_owner",
    role
  };
  const props: ComponentProps<typeof Workspace> = {
    session,
    events: [
      event("room.created", { name: "Room" }, 1),
      event("participant.joined", { participant: { id: "user_owner", display_name: "Owner", role: "owner", type: "human" } }, 2),
      event("join_request.created", { request_id: "join_req_1", display_name: "Bob" }, 3)
    ],
    onLeaveRoom: () => {},
    onClearRoom: () => {},
    onSendMessage: () => {},
    onStartCollection: () => {},
    onSubmitCollection: () => {},
    onCancelCollection: () => {},
    onSelectAgent: () => {},
    onCreateInvite: async () => undefined,
    onApproveJoinRequest: () => {},
    onRejectJoinRequest: () => {},
    onRemoveParticipant: () => {},
    ...callbacks
  };

  render(
    <LangProvider>
      <Workspace {...props} />
    </LangProvider>
  );
}

describe("Workspace join request modal", () => {
  it("shows a pending join request modal to the room owner", () => {
    renderWorkspace("owner");

    expect(screen.getByRole("dialog", { name: "Join request" })).toBeInTheDocument();
    expect(screen.getByText("Bob wants to join this room.")).toBeInTheDocument();
  });

  it("does not show the modal to non-owners", () => {
    renderWorkspace("member");

    expect(screen.queryByRole("dialog", { name: "Join request" })).not.toBeInTheDocument();
  });

  it("approves and rejects from the modal", () => {
    const onApproveJoinRequest = vi.fn();
    const onRejectJoinRequest = vi.fn();
    renderWorkspace("owner", { onApproveJoinRequest, onRejectJoinRequest });

    const dialog = screen.getByRole("dialog", { name: "Join request" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));

    expect(onApproveJoinRequest).toHaveBeenCalledWith("join_req_1");
    expect(onRejectJoinRequest).toHaveBeenCalledWith("join_req_1");
  });

  it("dismisses the modal locally", () => {
    renderWorkspace("owner");

    fireEvent.click(within(screen.getByRole("dialog", { name: "Join request" })).getByRole("button", { name: "Later" }));

    expect(screen.queryByRole("dialog", { name: "Join request" })).not.toBeInTheDocument();
  });
});

describe("Workspace agent exclusion", () => {
  it("shows agents separately in avatar rail and control center", () => {
    const session: RoomSession = {
      room_id: "room_1",
      token: "token_1",
      participant_id: "user_owner",
      role: "owner"
    };
    const props: ComponentProps<typeof Workspace> = {
      session,
      events: [
        event("room.created", { name: "Room" }, 1),
        event("participant.joined", { participant: { id: "user_owner", display_name: "Owner", role: "owner", type: "human" } }, 2),
        event("agent.registered", { agent_id: "agent_1", name: "Claude Code", capabilities: ["read", "write"] }, 3),
        event("agent.status_changed", { agent_id: "agent_1", status: "online" }, 4),
        event("room.agent_selected", { agent_id: "agent_1" }, 5)
      ],
      onLeaveRoom: () => {},
      onClearRoom: () => {},
      onSendMessage: () => {},
      onStartCollection: () => {},
      onSubmitCollection: () => {},
      onCancelCollection: () => {},
      onSelectAgent: () => {},
      onCreateInvite: async () => undefined,
      onApproveJoinRequest: () => {},
      onRejectJoinRequest: () => {},
      onRemoveParticipant: () => {}
    };

    render(
      <LangProvider>
        <Workspace {...props} />
      </LangProvider>
    );

    // Avatar rail shows separate Humans and Agents groups
    expect(screen.getByText("Humans")).toBeInTheDocument();
    expect(screen.getByText("Agents")).toBeInTheDocument();

    // Open Room Control Center
    fireEvent.click(screen.getByRole("button", { name: /Room controls/i }));
    const controlCenter = screen.getByRole("dialog", { name: /Room Control Center/i });
    expect(controlCenter).toBeInTheDocument();

    // People tab shows only human participants
    fireEvent.click(screen.getByRole("button", { name: /People/i }));
    expect(within(controlCenter).getByText(/Owner/)).toBeInTheDocument();
    expect(within(controlCenter).queryByText(/Claude Code/)).not.toBeInTheDocument();

    // Agent tab shows the agent
    fireEvent.click(screen.getByRole("button", { name: /Agent/i }));
    expect(within(controlCenter).getByText(/Claude Code/)).toBeInTheDocument();
  });
});
