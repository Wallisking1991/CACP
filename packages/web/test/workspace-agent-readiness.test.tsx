import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Workspace from "../src/components/Workspace.js";
import { LangProvider } from "../src/i18n/LangProvider.js";
import type { CacpEvent } from "@cacp/protocol";
import type { RoomSession } from "../src/api.js";

function event(
  type: CacpEvent["type"],
  payload: Record<string, unknown>,
  sequence: number,
  actor_id = "user_1"
): CacpEvent {
  return {
    protocol: "cacp",
    version: "0.3.0",
    event_id: `evt_${sequence}`,
    room_id: "room_1",
    type,
    actor_id,
    created_at: `2026-04-25T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload,
  };
}

function renderWorkspace(
  events: CacpEvent[],
  role: RoomSession["role"] = "owner"
) {
  return render(
    <LangProvider>
      <Workspace
        session={{
          room_id: "room_1",
          token: "tok",
          participant_id: "user_1",
          role,
        }}
        events={events}
        onLeaveRoom={() => {}}
        onSendMessage={() => {}}
        onSelectAgent={() => {}}
        onCreateInvite={async () => undefined}
        onApproveJoinRequest={() => {}}
        onRejectJoinRequest={() => {}}
        onRemoveParticipant={() => {}}
      />
    </LangProvider>
  );
}

describe("Workspace agent readiness UI", () => {
  const baseEvents = [
    event("room.created", { name: "Test Room" }, 1),
    event(
      "participant.joined",
      {
        participant: {
          id: "user_1",
          display_name: "Alice",
          role: "owner",
          type: "human",
        },
      },
      2
    ),
  ];

  it("shows waiting banner and disables composer when no agent", () => {
    renderWorkspace(baseEvents);
    expect(screen.getByTestId("agent-status-banner")).toHaveAttribute(
      "data-status",
      "no_agent"
    );
    expect(
      screen.getByPlaceholderText(/Type a message for the Agent/i)
    ).toBeDisabled();
  });

  it("shows selecting session banner for owner when agent needs session selection", () => {
    const events = [
      ...baseEvents,
      event(
        "agent.registered",
        {
          agent_id: "agent_1",
          name: "Claude Code",
          capabilities: ["claude-code"],
        },
        3
      ),
      event("room.agent_selected", { agent_id: "agent_1" }, 4),
      event(
        "claude.session_catalog.updated",
        { agent_id: "agent_1", working_dir: "/tmp", sessions: [] },
        5
      ),
    ];
    renderWorkspace(events);
    expect(screen.getByTestId("agent-status-banner")).toHaveAttribute(
      "data-status",
      "selecting_session"
    );
    expect(
      screen.getByPlaceholderText(/Type a message for the Agent/i)
    ).toBeDisabled();
  });

  it("shows waiting for owner banner for non-owner when agent needs session selection", () => {
    const events = [
      ...baseEvents,
      event(
        "agent.registered",
        {
          agent_id: "agent_1",
          name: "Claude Code",
          capabilities: ["claude-code"],
        },
        3
      ),
      event("room.agent_selected", { agent_id: "agent_1" }, 4),
      event(
        "claude.session_catalog.updated",
        { agent_id: "agent_1", working_dir: "/tmp", sessions: [] },
        5
      ),
    ];
    renderWorkspace(events, "member");
    expect(screen.getByTestId("agent-status-banner")).toHaveAttribute(
      "data-status",
      "selecting_session"
    );
    expect(screen.getByText(/Waiting for owner/i)).toBeInTheDocument();
  });

  it("hides banner and enables composer when agent is ready", () => {
    const events = [
      ...baseEvents,
      event(
        "agent.registered",
        {
          agent_id: "agent_1",
          name: "Claude Code",
          capabilities: ["claude-code"],
        },
        3
      ),
      event("room.agent_selected", { agent_id: "agent_1" }, 4),
      event(
        "claude.session_catalog.updated",
        { agent_id: "agent_1", working_dir: "/tmp", sessions: [] },
        5
      ),
      event(
        "claude.session_selected",
        { agent_id: "agent_1", mode: "fresh", selected_by: "user_1" },
        6
      ),
      event(
        "claude.session_ready",
        {
          agent_id: "agent_1",
          mode: "fresh",
          ready_at: "2026-04-25T00:00:07.000Z",
        },
        7
      ),
    ];
    renderWorkspace(events);
    expect(screen.queryByTestId("agent-status-banner")).not.toBeInTheDocument();
    const textarea = screen.getByPlaceholderText(
      /Type a message for the Agent/i
    );
    expect(textarea).not.toBeDisabled();
  });

  it("does not show fullscreen modal when session selection is needed", () => {
    const events = [
      ...baseEvents,
      event(
        "agent.registered",
        {
          agent_id: "agent_1",
          name: "Claude Code",
          capabilities: ["claude-code"],
        },
        3
      ),
      event("room.agent_selected", { agent_id: "agent_1" }, 4),
      event(
        "claude.session_catalog.updated",
        { agent_id: "agent_1", working_dir: "/tmp", sessions: [] },
        5
      ),
    ];
    renderWorkspace(events);
    expect(
      screen.queryByRole("dialog", { name: /Select Agent Session/i })
    ).not.toBeInTheDocument();
  });
});
