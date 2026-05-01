import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentStatusCard } from "../src/components/AgentStatusCard.js";

describe("AgentStatusCard", () => {
  it("renders Codex runtime command status", () => {
    render(
      <AgentStatusCard
        status={{
          agent_id: "agent_1",
          provider: "codex-cli",
          turn_id: "turn_1",
          status_id: "status_turn_1",
          phase: "running_command",
          current: "Codex running command: Get-ChildItem -Force",
          recent: ["Codex running command: Get-ChildItem -Force"],
          metrics: { files_read: 0, searches: 0, commands: 1 },
          started_at: "2026-05-01T00:00:00.000Z",
          updated_at: "2026-05-01T00:00:01.000Z"
        }}
      />
    );

    expect(screen.getByText(/Codex CLI/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Get-ChildItem/i).length).toBeGreaterThan(0);
  });

  it("renders Claude Code runtime status", () => {
    render(
      <AgentStatusCard
        status={{
          agent_id: "agent_1",
          provider: "claude-code",
          turn_id: "turn_1",
          status_id: "status_turn_1",
          phase: "reading_files",
          current: "Reading README.md",
          recent: ["Reading README.md"],
          metrics: { files_read: 1, searches: 0, commands: 0 },
          started_at: "2026-04-29T00:00:00.000Z",
          updated_at: "2026-04-29T00:00:10.000Z"
        }}
      />
    );

    expect(screen.getByText(/Claude Code/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Reading README.md/).length).toBeGreaterThan(0);
  });
});
