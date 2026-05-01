import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentSessionPicker } from "../src/components/AgentSessionPicker.js";

describe("AgentSessionPicker", () => {
  it("renders Codex CLI session choices and selects a resumed session", async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    const onRequestPreview = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentSessionPicker
        canManageRoom={true}
        agentId="agent_1"
        provider="codex-cli"
        catalog={{
          agent_id: "agent_1",
          provider: "codex-cli",
          working_dir: "D:\\Development\\2",
          sessions: [{
            session_id: "session_1",
            title: "Codex thread",
            project_dir: "D:\\Development\\2",
            updated_at: "2026-05-01T00:00:00.000Z",
            message_count: 2,
            byte_size: 100,
            importable: true,
            provider: "codex-cli"
          }]
        }}
        selection={undefined}
        previews={[]}
        onRequestPreview={onRequestPreview}
        onSelect={onSelect}
      />
    );

    expect(screen.getAllByText(/Codex CLI/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /^Inspect$/i }));
    expect(screen.getByRole("dialog", { name: /Session details/i })).toBeInTheDocument();
    await waitFor(() => expect(onRequestPreview).toHaveBeenCalledWith("session_1"));
  });

  it("renders Claude Code session choices when provider is claude-code", () => {
    render(
      <AgentSessionPicker
        canManageRoom={true}
        agentId="agent_1"
        provider="claude-code"
        catalog={{
          agent_id: "agent_1",
          provider: "claude-code",
          working_dir: "D:\\Development\\2",
          sessions: [{
            session_id: "session_1",
            title: "Planning",
            project_dir: "D:\\Development\\2",
            updated_at: "2026-04-29T00:00:00.000Z",
            message_count: 2,
            byte_size: 100,
            importable: true,
            provider: "claude-code"
          }]
        }}
        selection={undefined}
        previews={[]}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getAllByText(/Claude Code/i).length).toBeGreaterThan(0);
  });

  it("does not hide the active agent picker when a different agent has a selection", () => {
    render(
      <AgentSessionPicker
        canManageRoom={true}
        agentId="agent_1"
        provider="codex-cli"
        catalog={{
          agent_id: "agent_1",
          provider: "codex-cli",
          working_dir: "D:\\Development\\2",
          sessions: [{
            session_id: "session_1",
            title: "Codex thread",
            project_dir: "D:\\Development\\2",
            updated_at: "2026-05-01T00:00:00.000Z",
            message_count: 2,
            byte_size: 100,
            importable: true,
            provider: "codex-cli"
          }]
        }}
        selection={{ agent_id: "agent_2", provider: "claude-code", mode: "fresh", selected_by: "owner" }}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getAllByText(/Codex CLI/i).length).toBeGreaterThan(0);
  });
});
