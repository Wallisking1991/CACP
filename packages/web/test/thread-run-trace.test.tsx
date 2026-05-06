import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import Thread from "../src/components/Thread.js";
import { LangProvider } from "../src/i18n/LangProvider.js";
import type { AgentRunView, MessageView, StreamingTurnView } from "../src/room-state.js";

function renderThread(props: {
  messages?: MessageView[];
  streamingTurns?: StreamingTurnView[];
  agentRuns?: AgentRunView[];
  onResolveApproval?: (runId: string, nodeId: string, decision: "allow" | "deny", reason?: string) => void;
  onResolveElicitation?: (runId: string, nodeId: string, action: "accept" | "decline" | "cancel", content?: Record<string, unknown>) => void;
}) {
  return render(
    <LangProvider>
      <Thread
        currentParticipantId="user_1"
        messages={props.messages ?? []}
        streamingTurns={props.streamingTurns ?? []}
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

const thinkingNode: AgentRunView["nodes"][number] = {
  run_id: "turn_1",
  turn_id: "turn_1",
  agent_id: "agent_1",
  provider: "claude-code",
  node_id: "thinking_0",
  kind: "reasoning_summary",
  status: "streaming",
  title: "Thinking",
  text_chunks: ["I should inspect the directory first."],
  stdout_chunks: [],
  stderr_chunks: [],
  started_at: "2026-05-06T00:00:01.000Z",
  updated_at: "2026-05-06T00:00:02.000Z"
};

describe("Thread run trace", () => {
  it("renders a running run trace as one card with the live answer and no legacy stream bubble", () => {
    renderThread({
      streamingTurns: [{ turn_id: "turn_1", agent_id: "agent_1", text: "Legacy streaming answer" }],
      agentRuns: [{
        ...activeRun,
        answer_text: "Live answer from run trace"
      }]
    });

    expect(screen.getByText("Live answer from run trace")).toBeInTheDocument();
    expect(screen.queryByText("Legacy streaming answer")).not.toBeInTheDocument();
    expect(document.querySelectorAll("article.message-ai-card")).toHaveLength(1);
  });

  it("renders a completed run trace answer in the run card and suppresses the duplicate final message", () => {
    renderThread({
      messages: [{
        message_id: "msg_1",
        turn_id: "turn_1",
        actor_id: "agent_1",
        text: "Legacy final message",
        kind: "agent",
        created_at: "2026-05-06T00:00:09.000Z"
      }],
      agentRuns: [{
        ...activeRun,
        status: "completed",
        answer_text: "Streaming answer",
        final_text: "Final answer in run card",
        message_id: "msg_1",
        completed_at: "2026-05-06T00:00:08.000Z",
        nodes: [{ ...activeRun.nodes[0], status: "completed", summary: "Read guidance", completed_at: "2026-05-06T00:00:04.000Z" }]
      }]
    });

    expect(screen.getByText("Final answer in run card")).toBeInTheDocument();
    expect(screen.queryByText("Legacy final message")).not.toBeInTheDocument();
    expect(document.querySelector(".agent-run-card__process")).toBeInTheDocument();
    expect(document.querySelectorAll("article.message-ai-card")).toHaveLength(1);
  });

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
    expect(document.querySelector(".agent-run-card__process")).toBeInTheDocument();
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

  it("shows the work process expanded while the run is active", () => {
    renderThread({
      agentRuns: [{
        ...activeRun,
        nodes: [thinkingNode, { ...activeRun.nodes[0], title: "Search files: src/**/*.ts", detail: { elapsed_time_seconds: 2 } }],
        answer_text: "Partial answer"
      }]
    });

    const process = document.querySelector("details.agent-run-card__process") as HTMLDetailsElement | null;
    expect(process).not.toBeNull();
    const processScope = within(process as HTMLElement);
    expect(process?.open).toBe(true);
    expect(screen.getByText("Partial answer")).toBeVisible();
    expect(processScope.getByText(/Work process/)).toBeVisible();
    expect(processScope.getAllByText("Thinking")[0]).toBeVisible();
    expect(processScope.getByText("I should inspect the directory first.")).toBeVisible();
    expect(processScope.getByText("Search files: src/**/*.ts")).toBeVisible();
  });

  it("shows the final answer first and collapses the work process after completion", () => {
    renderThread({
      agentRuns: [{
        ...activeRun,
        status: "completed",
        final_text: "Final answer in run card",
        completed_at: "2026-05-06T00:00:08.000Z",
        metrics: { files_read: 0, searches: 1, commands: 0 },
        usage: { duration_ms: 2345, output_tokens: 50, total_cost_usd: 0.0123 },
        nodes: [{ ...thinkingNode, status: "completed", completed_at: "2026-05-06T00:00:03.000Z" }, { ...activeRun.nodes[0], status: "completed", title: "Search files: src/**/*.ts", completed_at: "2026-05-06T00:00:04.000Z" }]
      }]
    });

    const answer = screen.getByText("Final answer in run card");
    expect(answer).toBeVisible();
    const process = document.querySelector("details.agent-run-card__process") as HTMLDetailsElement | null;
    expect(process).not.toBeNull();
    expect(answer.compareDocumentPosition(process as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(process?.open).toBe(false);
    expect(within(process as HTMLElement).getByText(/Work process/)).toBeVisible();
    expect(screen.getAllByText(/\b1 search\b/)[0]).toBeVisible();
  });
});
