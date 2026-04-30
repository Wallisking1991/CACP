import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
  onStartCollection: vi.fn(),
  onSubmitCollection: vi.fn(),
  onCancelCollection: vi.fn(),
  onSelectAgent: vi.fn(),
  onCreateInvite: vi.fn(async () => "http://localhost/invite"),
  onApproveJoinRequest: vi.fn(),
  onRejectJoinRequest: vi.fn(),
  onRemoveParticipant: vi.fn(),
  onRequestRoundtable: vi.fn(),
  onApproveRoundtableRequest: vi.fn(),
  onRejectRoundtableRequest: vi.fn()
};

describe("Workspace studio shell", () => {
  it("uses slim header, floating controls, and centered control modal", () => {
    render(<LangProvider><Workspace {...baseProps} /></LangProvider>);

    expect(screen.getByText("CACP AI Room")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Toggle language/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Leave Room/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Room controls/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Room controls/i }));
    expect(screen.getByRole("dialog", { name: /Room Control Center/i })).toBeInTheDocument();
  });
});
