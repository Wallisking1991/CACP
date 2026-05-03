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
  onSendMessage: vi.fn(),
  onSelectAgent: vi.fn(),
  onCreateInvite: vi.fn(async () => "http://localhost/invite"),
  onApproveJoinRequest: vi.fn(),
  onRejectJoinRequest: vi.fn(),
  onRemoveParticipant: vi.fn()
};

describe("Workspace refactored shell", () => {
  it("shows header with room name and MoreMenu button", () => {
    render(<LangProvider><Workspace {...baseProps} /></LangProvider>);

    expect(screen.getByText("CACP AI Room")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /more options/i })).toBeInTheDocument();
  });

  it("does not show Room Control Center button", () => {
    render(<LangProvider><Workspace {...baseProps} /></LangProvider>);
    expect(screen.queryByRole("button", { name: /Room controls/i })).not.toBeInTheDocument();
  });

  it("opens sound panel through MoreMenu", () => {
    render(<LangProvider><Workspace {...baseProps} /></LangProvider>);

    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    fireEvent.click(screen.getByText(/Sound/));
    expect(screen.getByRole("slider", { name: /volume/i })).toBeInTheDocument();
  });

  it("opens log panel through MoreMenu", () => {
    render(<LangProvider><Workspace {...baseProps} /></LangProvider>);

    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    fireEvent.click(screen.getByText(/Logs/));
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

    expect(screen.getByRole("button", { name: /notifications/i })).toBeInTheDocument();
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
    expect(screen.getAllByText("Wei")).toHaveLength(1);
  });

  it("opens agent popover when agent avatar is clicked", () => {
    render(<LangProvider><Workspace {...baseProps} /></LangProvider>);

    const agentStack = screen.getByLabelText("Claude Code Agent, AI, idle").closest(".role-avatar-stack") as HTMLElement;
    fireEvent.click(agentStack);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByText("Claude Code Agent")).toHaveLength(1);
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

  it("starts collapsed and toggles Orbit from the right-edge tab", () => {
    render(<LangProvider><Workspace {...baseProps} /></LangProvider>);
    expect(document.querySelector(".orbit-layer")).toBeNull();
    const toggle = screen.getByRole("button", { name: /Toggle discussion/i });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(document.querySelector(".orbit-layer")).not.toBeNull();
    expect(document.querySelector(".workspace-grid--with-orbit")).not.toBeNull();
  });

  it("shows the main composer regardless of Orbit panel state", () => {
    render(<LangProvider><Workspace {...baseProps} /></LangProvider>);

    expect(screen.getByRole("button", { name: /Trigger Agent/i })).toBeInTheDocument();
    expect(screen.getByTestId("main-composer")).toBeInTheDocument();
    expect(screen.queryByTestId("orbit-composer")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Toggle discussion/i }));
    expect(screen.getByTestId("orbit-composer")).toBeInTheDocument();
    expect(screen.getByTestId("main-composer")).toBeInTheDocument();
  });

  it("keeps the Orbit panel inside the workspace grid when open so it cannot cover the composer", () => {
    render(<LangProvider><Workspace {...baseProps} /></LangProvider>);

    fireEvent.click(screen.getByRole("button", { name: /Toggle discussion/i }));

    const grid = document.querySelector(".workspace-grid");
    expect(grid).not.toBeNull();
    expect(grid?.querySelector(":scope > .chat-panel")).not.toBeNull();
    expect(grid?.querySelector(":scope > .orbit-panel")).not.toBeNull();
  });

  it("does not count initial replay as unread but counts later foreign notes", () => {
    const initial = [
      ...baseProps.events,
      event("participant.joined", { participant: { id: "user_2", display_name: "Bob", role: "member", type: "human" } }, 4),
      event("orbit.note.created", { note_id: "note_1", text: "Replay" }, 5, "user_2")
    ];
    const { rerender } = render(<LangProvider><Workspace {...baseProps} events={initial} /></LangProvider>);
    expect(screen.queryByText("1")).not.toBeInTheDocument();
    rerender(
      <LangProvider>
        <Workspace
          {...baseProps}
          events={[...initial, event("orbit.note.created", { note_id: "note_2", text: "Live" }, 6, "user_2")]}
        />
      </LangProvider>
    );
    expect(screen.getByText("1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Toggle discussion/i }));
    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });

  it("does not count orbit notes from the initial WS replay as unread on a fresh join", () => {
    // Reproduces the live-join bug: a participant whose initial events array
    // is empty (mounting before WS replay arrives) should NOT see the unread
    // badge once the replay batch lands. Notes posted before this participant
    // joined are filtered by payload.created_at < participant_joined_at —
    // mirroring how the server attaches a fresh event-level created_at on
    // synthetic replay events while preserving each note's original
    // creation time inside the payload.
    const aliceJoinedAt = "2026-04-30T00:00:02.000Z";
    const bobJoinedAt = "2026-04-30T01:00:00.000Z";
    const replayDeliveredAt = "2026-04-30T02:00:00.000Z"; // server attaches NOW when replaying
    const earlyAliceNote = event("orbit.note.created", { note_id: "early_1", text: "Before Bob", created_at: "2026-04-30T00:30:00.000Z" }, 5, "user_1");
    earlyAliceNote.created_at = replayDeliveredAt;
    const earlyAliceNote2 = event("orbit.note.created", { note_id: "early_2", text: "Before Bob 2", created_at: "2026-04-30T00:45:00.000Z" }, 6, "user_1");
    earlyAliceNote2.created_at = replayDeliveredAt;

    const bobBaseProps = {
      ...baseProps,
      session: { room_id: "room_1", token: "bob_secret", participant_id: "user_2", role: "member" as const }
    };

    const { rerender } = render(<LangProvider><Workspace {...bobBaseProps} events={[]} /></LangProvider>);
    expect(screen.queryByText("1")).not.toBeInTheDocument();

    // Replay arrives one event at a time via WS.
    const aliceJoin = event("participant.joined", { participant: { id: "user_1", display_name: "Alice", role: "owner", type: "human" } }, 2);
    aliceJoin.created_at = aliceJoinedAt;
    const bobJoin = event("participant.joined", { participant: { id: "user_2", display_name: "Bob", role: "member", type: "human" } }, 3, "user_2");
    bobJoin.created_at = bobJoinedAt;

    const replayEvents = [event("room.created", { name: "Room" }, 1), aliceJoin, bobJoin, earlyAliceNote, earlyAliceNote2];
    for (let i = 1; i <= replayEvents.length; i++) {
      rerender(<LangProvider><Workspace {...bobBaseProps} events={replayEvents.slice(0, i)} /></LangProvider>);
    }
    expect(screen.queryByText("1")).not.toBeInTheDocument();
    expect(screen.queryByText("2")).not.toBeInTheDocument();
  });

  it("counts a foreign orbit note that arrives after the current participant joined", () => {
    const bobBaseProps = {
      ...baseProps,
      session: { room_id: "room_1", token: "bob_secret", participant_id: "user_2", role: "member" as const }
    };
    const aliceJoin = event("participant.joined", { participant: { id: "user_1", display_name: "Alice", role: "owner", type: "human" } }, 2);
    aliceJoin.created_at = "2026-04-30T00:00:02.000Z";
    const bobJoin = event("participant.joined", { participant: { id: "user_2", display_name: "Bob", role: "member", type: "human" } }, 3, "user_2");
    bobJoin.created_at = "2026-04-30T01:00:00.000Z";

    const initial = [event("room.created", { name: "Room" }, 1), aliceJoin, bobJoin];
    const { rerender } = render(<LangProvider><Workspace {...bobBaseProps} events={[]} /></LangProvider>);
    for (let i = 1; i <= initial.length; i++) {
      rerender(<LangProvider><Workspace {...bobBaseProps} events={initial.slice(0, i)} /></LangProvider>);
    }
    expect(screen.queryByText("1")).not.toBeInTheDocument();

    // Alice posts a NEW note AFTER Bob joined
    const liveAliceNote = event("orbit.note.created", { note_id: "live_1", text: "After Bob joined" }, 4, "user_1");
    liveAliceNote.created_at = "2026-04-30T01:30:00.000Z";
    rerender(<LangProvider><Workspace {...bobBaseProps} events={[...initial, liveAliceNote]} /></LangProvider>);
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("opens the promote modal listing flat-pool Orbit notes when the header button is clicked", () => {
    const props = {
      ...baseProps,
      events: [
        ...baseProps.events,
        event("orbit.note.created", { note_id: "note_1", text: "Promote this note" }, 5, "user_1")
      ]
    };

    render(<LangProvider><Workspace {...props} /></LangProvider>);

    fireEvent.click(screen.getByRole("button", { name: /Toggle discussion/i }));

    const openButton = screen.getByRole("button", { name: /Promote orbit notes/i });
    expect(openButton).not.toBeDisabled();
    fireEvent.click(openButton);

    const dialog = screen.getByRole("dialog", { name: /Promote to Main Thread/i });
    expect(within(dialog).getByText("Promote this note")).toBeInTheDocument();
  });
});
