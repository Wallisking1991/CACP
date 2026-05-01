import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { LangProvider } from "../src/i18n/LangProvider.js";
import { RoomControlCenter } from "../src/components/RoomControlCenter.js";

const baseProps = {
  open: true,
  onClose: vi.fn(),
  soundEnabled: true,
  soundVolume: 0.5,
  onSoundEnabledChange: vi.fn(),
  onSoundVolumeChange: vi.fn(),
  onTestSound: vi.fn(),
  agents: [{ agent_id: "agent_1", name: "Claude Code Agent", capabilities: ["repo.read"], status: "online" as const }],
  activeAgentId: "agent_1",
  participants: [{ id: "user_1", display_name: "Wei", role: "owner", type: "human" }],
  inviteCount: 0,
  invites: [],
  isOwner: true,
  roomId: "room_1",
  onLeaveRoom: vi.fn(),
  onCreateInvite: vi.fn(async () => "http://localhost/invite"),
  onSelectAgent: vi.fn(),
  onRemoveParticipant: vi.fn(),
  onClearRoom: vi.fn(),
  joinRequests: [],
  onApproveJoinRequest: vi.fn(),
  onRejectJoinRequest: vi.fn(),
  canManageRoom: true,
  claudeSessionPreviews: [],
  claudeRuntimeStatuses: [],
  serverUrl: "http://localhost:3737",
  roomSessionToken: "test-token",
  roomSessionParticipantId: "user_1",
  onRequestClaudeSessionPreview: vi.fn(async () => {}),
  onSelectClaudeSession: vi.fn(async () => {})
};

describe("RoomControlCenter", () => {
  it("shows control sections and toggles sound", () => {
    render(<LangProvider><RoomControlCenter {...baseProps} /></LangProvider>);

    expect(screen.getByRole("dialog", { name: /Room Control Center/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Agent/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /People/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Invite/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sound/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Sound/i }));
    fireEvent.click(screen.getByRole("switch", { name: /Sound cues/i }));
    expect(baseProps.onSoundEnabledChange).toHaveBeenCalledWith(false);
  });

  it("shows invite size preset and passes maxUses to onCreateInvite", () => {
    render(<LangProvider><RoomControlCenter {...baseProps} /></LangProvider>);

    fireEvent.click(screen.getByRole("button", { name: /Invite/i }));

    const sizeSelect = screen.getByLabelText(/Invite size/i);
    expect(sizeSelect).toBeInTheDocument();

    fireEvent.change(sizeSelect, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /Copy/i }));

    expect(baseProps.onCreateInvite).toHaveBeenCalledWith("member", 3600, 5);
  });

  it("renders active invites with remaining slots", () => {
    const props = {
      ...baseProps,
      invites: [
        { invite_id: "inv_1", role: "member", expires_at: "2026-04-26T00:00:00.000Z", max_uses: 5, used_count: 2, remaining: 3, revoked: false },
        { invite_id: "inv_2", role: "observer", expires_at: "2026-04-27T00:00:00.000Z", max_uses: 3, used_count: 3, remaining: 0, revoked: true }
      ]
    };
    render(<LangProvider><RoomControlCenter {...props} /></LangProvider>);

    fireEvent.click(screen.getByRole("button", { name: /Invite/i }));

    expect(screen.getByText(/member — 3\/5 left/i)).toBeInTheDocument();
    expect(screen.getByText(/Closed/i)).toBeInTheDocument();
  });
});
