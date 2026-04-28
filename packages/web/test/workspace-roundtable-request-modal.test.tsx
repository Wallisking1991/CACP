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
    participant_id: role === "owner" ? "user_owner" : "user_member",
    role
  };
  const props: ComponentProps<typeof Workspace> = {
    session,
    events: [
      event("room.created", { name: "Room" }, 1),
      event("participant.joined", { participant: { id: "user_owner", display_name: "Owner", role: "owner", type: "human" } }, 2),
      event("participant.joined", { participant: { id: "user_member", display_name: "Bob", role: "member", type: "human" } }, 3, "user_member"),
      event("ai.collection.requested", { request_id: "collection_request_1", requested_by: "user_member" }, 4, "user_member")
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
    onRequestRoundtable: () => {},
    onApproveRoundtableRequest: () => {},
    onRejectRoundtableRequest: () => {},
    ...callbacks
  };

  render(
    <LangProvider>
      <Workspace {...props} />
    </LangProvider>
  );
}

describe("Workspace roundtable request modal", () => {
  it("shows a pending roundtable request modal to the room owner", () => {
    renderWorkspace("owner");

    expect(screen.getByRole("dialog", { name: "Roundtable request" })).toBeInTheDocument();
    expect(screen.getByText("Bob wants to start Roundtable Mode.")).toBeInTheDocument();
  });

  it("does not show the modal to non-owners", () => {
    renderWorkspace("member");

    expect(screen.queryByRole("dialog", { name: "Roundtable request" })).not.toBeInTheDocument();
  });

  it("approves from the modal", () => {
    const onApproveRoundtableRequest = vi.fn();
    renderWorkspace("owner", { onApproveRoundtableRequest });

    fireEvent.click(within(screen.getByRole("dialog", { name: "Roundtable request" })).getByRole("button", { name: "Start Roundtable" }));
    expect(onApproveRoundtableRequest).toHaveBeenCalledWith("collection_request_1");
  });

  it("rejects from the modal", () => {
    const onRejectRoundtableRequest = vi.fn();
    renderWorkspace("owner", { onRejectRoundtableRequest });

    fireEvent.click(within(screen.getByRole("dialog", { name: "Roundtable request" })).getByRole("button", { name: "Reject" }));
    expect(onRejectRoundtableRequest).toHaveBeenCalledWith("collection_request_1");
  });

  it("dismisses the modal locally while keeping the request", () => {
    renderWorkspace("owner");

    fireEvent.click(within(screen.getByRole("dialog", { name: "Roundtable request" })).getByRole("button", { name: "Later" }));

    expect(screen.queryByRole("dialog", { name: "Roundtable request" })).not.toBeInTheDocument();
  });

  it("disables Start Roundtable when a turn is in flight", () => {
    const onApproveRoundtableRequest = vi.fn();
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
        event("participant.joined", { participant: { id: "user_member", display_name: "Bob", role: "member", type: "human" } }, 3, "user_member"),
        event("agent.registered", { agent_id: "agent_1", name: "Claude Code", capabilities: ["read", "write"] }, 4),
        event("agent.status_changed", { agent_id: "agent_1", status: "online" }, 5),
        event("room.agent_selected", { agent_id: "agent_1" }, 6),
        event("agent.turn.started", { turn_id: "turn_1", agent_id: "agent_1" }, 7),
        event("ai.collection.requested", { request_id: "collection_request_1", requested_by: "user_member" }, 8, "user_member")
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
      onRequestRoundtable: () => {},
      onApproveRoundtableRequest: onApproveRoundtableRequest,
      onRejectRoundtableRequest: () => {}
    };

    render(
      <LangProvider>
        <Workspace {...props} />
      </LangProvider>
    );

    const dialog = screen.getByRole("dialog", { name: "Roundtable request" });
    const startBtn = within(dialog).getByRole("button", { name: "Start Roundtable" });
    expect(startBtn).toBeDisabled();
    expect(screen.getByText(/AI is replying\. Start Roundtable after this turn finishes\./i)).toBeInTheDocument();
  });
});
