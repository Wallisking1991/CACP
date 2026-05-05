import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import Thread from "../src/components/Thread.js";
import { LangProvider } from "../src/i18n/LangProvider.js";
import type { AgentRunView } from "../src/room-state.js";

function renderThread(props: {
  agentRuns?: AgentRunView[];
  onResolveApproval?: (runId: string, nodeId: string, decision: "allow" | "deny", reason?: string) => void;
  onResolveElicitation?: (runId: string, nodeId: string, action: "accept" | "decline" | "cancel", content?: Record<string, unknown>) => void;
}) {
  return render(
    <LangProvider>
      <Thread
        currentParticipantId="user_1"
        messages={[]}
        streamingTurns={[]}
        agentRuns={props.agentRuns ?? []}
        actorNames={new Map([["agent_1", "Claude Code Agent"]])}
        claudeImports={[]}
        agentImports={[]}
        onResolveApproval={props.onResolveApproval}
        onResolveElicitation={props.onResolveElicitation}
      />
    </LangProvider>
  );
}

const activeRun: AgentRunView = {
  run_id: "turn_1",
  turn_id: "turn_1",
  agent_id: "agent_1",
  provider: "claude-code",
  status: "running",
  started_at: "2026-05-06T00:00:01.000Z",
  nodes: [{
    run_id: "turn_1",
    turn_id: "turn_1",
    agent_id: "agent_1",
    provider: "claude-code",
    node_id: "node_1",
    kind: "tool",
    status: "running",
    title: "Read AGENTS.md",
    text_chunks: ["Scanning repo guidance"],
    stdout_chunks: [],
    stderr_chunks: [],
    started_at: "2026-05-06T00:00:02.000Z",
    updated_at: "2026-05-06T00:00:03.000Z"
  }]
};

describe("Thread run trace", () => {
  it("renders active run nodes in a live run card", () => {
    renderThread({ agentRuns: [activeRun] });

    const card = screen.getByText("Claude Code Agent").closest("article");
    expect(card).toHaveClass("agent-run-card");
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("Read AGENTS.md")).toBeInTheDocument();
    expect(screen.getByText("Scanning repo guidance")).toBeInTheDocument();
  });

  it("renders completed runs as collapsible summaries", () => {
    renderThread({
      agentRuns: [{
        ...activeRun,
        status: "completed",
        summary: "Answered with repo context",
        completed_at: "2026-05-06T00:00:08.000Z",
        metrics: { files_read: 2, searches: 1, commands: 0 },
        nodes: [{ ...activeRun.nodes[0], status: "completed", summary: "Read guidance", completed_at: "2026-05-06T00:00:04.000Z" }]
      }]
    });

    expect(screen.getByText("Answered with repo context")).toBeInTheDocument();
    expect(document.querySelector(".agent-run-card__details")).toBeInTheDocument();
  });

  it("renders failed runs with error text", () => {
    renderThread({
      agentRuns: [{
        ...activeRun,
        status: "failed",
        error: "codex_turn_incomplete",
        failed_at: "2026-05-06T00:00:08.000Z"
      }]
    });

    expect(screen.getByText("codex_turn_incomplete")).toBeInTheDocument();
  });

  it("fires approval callbacks from waiting approval nodes", () => {
    const onResolveApproval = vi.fn();
    renderThread({
      agentRuns: [{
        ...activeRun,
        nodes: [{
          ...activeRun.nodes[0],
          node_id: "approval_1",
          kind: "approval",
          status: "waiting_input",
          title: "Approve Bash command"
        }]
      }],
      onResolveApproval
    });

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(onResolveApproval).toHaveBeenCalledWith("turn_1", "approval_1", "allow");
  });
});
