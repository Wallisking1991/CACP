import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import type { CacpEvent } from "@cacp/protocol";
import Workspace from "../src/components/Workspace.js";
import { LangProvider } from "../src/i18n/LangProvider.js";

// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

function event(type: CacpEvent["type"], payload: Record<string, unknown>, sequence: number, actor_id = "user_1"): CacpEvent {
  return {
    protocol: "cacp",
    version: "0.2.0",
    event_id: `evt_${sequence}`,
    room_id: "room_1",
    type,
    actor_id,
    created_at: `2026-04-30T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload
  };
}

const baseProps = {
  session: { room_id: "room_1", token: "owner_secret", participant_id: "user_1", role: "owner" as const },
  events: [
    event("room.created", { name: "CACP AI Room" }, 1),
    event("participant.joined", { participant: { id: "user_1", display_name: "Wei", role: "owner", type: "human" } }, 2),
    event("agent.registered", { agent_id: "agent_1", name: "Claude Code Agent", capabilities: ["repo.read"] }, 3, "agent_1"),
    event("room.agent_selected", { agent_id: "agent_1" }, 4)
  ],
  onLeaveRoom: vi.fn(),
  onClearRoom: vi.fn(),
  onSendMessage: vi.fn(),
  onSelectAgent: vi.fn(),
  onCreateInvite: vi.fn(async () => "http://localhost/invite"),
  onApproveJoinRequest: vi.fn(),
  onRejectJoinRequest: vi.fn(),
  onRemoveParticipant: vi.fn()
};

describe("Workspace refactored shell", () => {
  it("shows header with room name, sound, notification, and log buttons", () => {
    render(<LangProvider><Workspace {...baseProps} /></LangProvider>);

    expect(screen.getByText("CACP AI Room")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sound/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /notifications/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /logs/i })).toBeInTheDocument();
  });

  it("does not show Room Control Center button", () => {
    render(<LangProvider><Workspace {...baseProps} /></LangProvider>);
    expect(screen.queryByRole("button", { name: /Room controls/i })).not.toBeInTheDocument();
  });

  it("opens sound panel when sound button is clicked", () => {
    render(<LangProvider><Workspace {...baseProps} /></LangProvider>);

    fireEvent.click(screen.getByRole("button", { name: /sound/i }));
    expect(screen.getByRole("slider", { name: /volume/i })).toBeInTheDocument();
  });

  it("opens log panel when log button is clicked", () => {
    render(<LangProvider><Workspace {...baseProps} /></LangProvider>);

    fireEvent.click(screen.getByRole("button", { name: /logs/i }));
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it("shows notification badge with pending join requests", () => {
    const props = {
      ...baseProps,
      events: [
        event("room.created", { name: "Room" }, 1),
        event("participant.joined", { participant: { id: "user_1", display_name: "Owner", role: "owner", type: "human" } }, 2),
        event("join_request.created", { request_id: "join_req_1", display_name: "Bob" }, 3)
      ]
    };
    render(<LangProvider><Workspace {...props} /></LangProvider>);

    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("does not auto-show join request modal", () => {
    const props = {
      ...baseProps,
      events: [
        event("room.created", { name: "Room" }, 1),
        event("participant.joined", { participant: { id: "user_1", display_name: "Owner", role: "owner", type: "human" } }, 2),
        event("join_request.created", { request_id: "join_req_1", display_name: "Bob" }, 3)
      ]
    };
    render(<LangProvider><Workspace {...props} /></LangProvider>);

    expect(screen.queryByRole("dialog", { name: "Join request" })).not.toBeInTheDocument();
  });

  it("opens notification panel with join request when notification button is clicked", () => {
    const onApproveJoinRequest = vi.fn();
    const onRejectJoinRequest = vi.fn();
    const props = {
      ...baseProps,
      events: [
        event("room.created", { name: "Room" }, 1),
        event("participant.joined", { participant: { id: "user_1", display_name: "Owner", role: "owner", type: "human" } }, 2),
        event("join_request.created", { request_id: "join_req_1", display_name: "Bob" }, 3)
      ],
      onApproveJoinRequest,
      onRejectJoinRequest
    };
    render(<LangProvider><Workspace {...props} /></LangProvider>);

    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText(/Join request/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Approve/i }));
    expect(onApproveJoinRequest).toHaveBeenCalledWith("join_req_1");
  });

  it("opens people popover when human avatar is clicked", () => {
    render(<LangProvider><Workspace {...baseProps} /></LangProvider>);

    const bobStack = screen.getByLabelText("Wei, Owner, online").closest(".role-avatar-stack") as HTMLElement;
    fireEvent.click(bobStack);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("People")).toBeInTheDocument();
    expect(screen.getAllByText("Wei")).toHaveLength(2);
  });

  it("opens agent popover when agent avatar is clicked", () => {
    render(<LangProvider><Workspace {...baseProps} /></LangProvider>);

    const agentStack = screen.getByLabelText("Claude Code Agent, AI, idle").closest(".role-avatar-stack") as HTMLElement;
    fireEvent.click(agentStack);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByText("Claude Code Agent")).toHaveLength(2);
  });

  it("keeps the Codex session-required modal open after selection until the connector reports ready", () => {
    const props = {
      ...baseProps,
      events: [
        event("room.created", { name: "CACP AI Room" }, 1),
        event("participant.joined", { participant: { id: "user_1", display_name: "Wei", role: "owner", type: "human" } }, 2),
        event("agent.registered", { agent_id: "agent_1", name: "Codex CLI Agent", capabilities: ["codex-cli"] }, 3, "agent_1"),
        event("room.agent_selected", { agent_id: "agent_1" }, 4),
        event("agent.session_catalog.updated" as CacpEvent["type"], {
          agent_id: "agent_1",
          provider: "codex-cli",
          working_dir: "D:\\Development\\2",
          sessions: []
        }, 5, "agent_1"),
        event("agent.session_selected" as CacpEvent["type"], {
          agent_id: "agent_1",
          provider: "codex-cli",
          mode: "fresh",
          selected_by: "user_1"
        }, 6, "user_1")
      ]
    };

    render(<LangProvider><Workspace {...props} /></LangProvider>);

    expect(screen.getByRole("dialog", { name: /Select Agent Session/i })).toBeInTheDocument();
    expect(screen.getByText(/Choose how Codex CLI joins this room/i)).toBeInTheDocument();
  });

  it("shows Orbit by default with separate People and Agent send actions", () => {
    render(<LangProvider><Workspace {...baseProps} /></LangProvider>);

    expect(screen.getByText("Orbit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send to People/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send to Agent/i })).toBeInTheDocument();
  });

  it("keeps the Orbit panel inside the workspace grid so it cannot cover the composer", () => {
    render(<LangProvider><Workspace {...baseProps} /></LangProvider>);

    const grid = document.querySelector(".workspace-grid");
    expect(grid).not.toBeNull();
    expect(grid?.querySelector(":scope > .chat-panel")).not.toBeNull();
    expect(grid?.querySelector(":scope > .orbit-panel")).not.toBeNull();
  });

  it("lists current-round Orbit notes in the promote tray", () => {
    const props = {
      ...baseProps,
      showOrbit: true,
      events: [
        ...baseProps.events,
        event("orbit.round.opened", { round_id: "round_1" }, 5, "user_1"),
        event("orbit.note.created", { note_id: "note_1", round_id: "round_1", text: "Promote this note" }, 6, "user_1")
      ]
    };

    render(<LangProvider><Workspace {...props} /></LangProvider>);

    const tray = screen.getByText(/Promote to Main Thread/i).closest(".orbit-promote-tray") as HTMLElement;
    expect(within(tray).getByText("Promote this note")).toBeInTheDocument();
  });
});
