import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentSessionRequiredModal } from "../src/components/AgentSessionRequiredModal.js";

describe("AgentSessionRequiredModal", () => {
  it("uses provider-neutral Codex copy when requiring a Codex session selection", () => {
    render(
      <AgentSessionRequiredModal
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
        previews={[]}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: /Select Agent Session/i })).toBeInTheDocument();
    expect(screen.getByText(/Codex CLI session/i)).toBeInTheDocument();
    expect(screen.getByText(/Choose how Codex CLI joins this room/i)).toBeInTheDocument();
    expect(screen.queryByText(/Claude Code session/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Inspect$/i }));

    expect(screen.getByRole("dialog", { name: /Session details/i })).toBeInTheDocument();
    expect(screen.queryByText(/This Claude Code session has no transcript/i)).not.toBeInTheDocument();
  });
});
