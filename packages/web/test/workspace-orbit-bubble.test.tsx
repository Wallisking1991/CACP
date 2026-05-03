import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import type { CacpEvent } from "@cacp/protocol";
import Workspace from "../src/components/Workspace.js";
import { LangProvider } from "../src/i18n/LangProvider.js";

Element.prototype.scrollIntoView = vi.fn();

function event(type: CacpEvent["type"], payload: Record<string, unknown>, sequence: number, actor_id = "user_1", recent = false): CacpEvent {
  return {
    protocol: "cacp",
    version: "0.2.0",
    event_id: `evt_${sequence}`,
    room_id: "room_1",
    type,
    actor_id,
    created_at: recent ? new Date().toISOString() : `2026-04-30T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload
  };
}

const baseProps = {
  session: { room_id: "room_1", token: "owner_secret", participant_id: "user_1", role: "owner" as const },
  events: [
    event("room.created", { name: "CACP AI Room" }, 1),
    event("participant.joined", { participant: { id: "user_1", display_name: "Wei", role: "owner", type: "human" } }, 2),
    event("participant.joined", { participant: { id: "user_2", display_name: "Bob", role: "member", type: "human" } }, 3),
    event("agent.registered", { agent_id: "agent_1", name: "Claude Code Agent", capabilities: ["repo.read"] }, 4, "agent_1"),
    event("room.agent_selected", { agent_id: "agent_1" }, 5)
  ],
  onLeaveRoom: vi.fn(),
  onSendMessage: vi.fn(),
  onSelectAgent: vi.fn(),
  onCreateInvite: vi.fn(async () => "http://localhost/invite"),
  onApproveJoinRequest: vi.fn(),
  onRejectJoinRequest: vi.fn(),
  onRemoveParticipant: vi.fn()
};

describe("Workspace Orbit bubbles", () => {
  it("shows bubble when orbit note from another participant arrives", () => {
    const props = {
      ...baseProps,
      events: [
        ...baseProps.events,
        event("orbit.note.created", { note_id: "note_1", text: "Hello orbit!" }, 6, "user_2", true)
      ]
    };
    render(<LangProvider><Workspace {...props} /></LangProvider>);

    const bubble = document.querySelector(".orbit-bubble__text");
    expect(bubble).toBeInTheDocument();
    expect(bubble).toHaveTextContent("Hello orbit!");
  });

  it("does not show bubble for own orbit notes", () => {
    const props = {
      ...baseProps,
      events: [
        ...baseProps.events,
        event("orbit.note.created", { note_id: "note_1", text: "My own note" }, 6, "user_1", true)
      ]
    };
    render(<LangProvider><Workspace {...props} /></LangProvider>);

    expect(document.querySelector(".orbit-bubble__text")).not.toBeInTheDocument();
  });

  it("does not show bubble when orbit panel is open", () => {
    const { rerender } = render(<LangProvider><Workspace {...baseProps} /></LangProvider>);

    // Open the orbit panel before the orbit note arrives
    const toggleBtn = screen.getByRole("button", { name: /Toggle discussion/i });
    fireEvent.click(toggleBtn);

    // Now send the orbit note
    const propsWithNote = {
      ...baseProps,
      events: [
        ...baseProps.events,
        event("orbit.note.created", { note_id: "note_1", text: "Hello orbit!" }, 6, "user_2", true)
      ]
    };
    rerender(<LangProvider><Workspace {...propsWithNote} /></LangProvider>);

    // No bubble should be visible while panel is open
    expect(document.querySelector(".orbit-bubble__text")).not.toBeInTheDocument();
  });

  it("replaces existing bubble from same sender", () => {
    const props = {
      ...baseProps,
      events: [
        ...baseProps.events,
        event("orbit.note.created", { note_id: "note_1", text: "First note" }, 6, "user_2", true),
        event("orbit.note.created", { note_id: "note_2", text: "Second note" }, 7, "user_2", true)
      ]
    };
    render(<LangProvider><Workspace {...props} /></LangProvider>);

    const bubbles = document.querySelectorAll(".orbit-bubble__text");
    expect(bubbles.length).toBe(1);
    expect(bubbles[0]).toHaveTextContent("Second note");
  });
});
