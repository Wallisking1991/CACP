import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import Thread from "../src/components/Thread.js";
import { LangProvider } from "../src/i18n/LangProvider.js";
import type { MessageView, StreamingTurnView } from "../src/room-state.js";

function renderThread(props: {
  messages?: MessageView[];
  streamingTurns?: StreamingTurnView[];
}) {
  return render(
    <LangProvider>
      <Thread
        currentParticipantId="user_1"
        messages={props.messages ?? []}
        streamingTurns={props.streamingTurns ?? []}
        actorNames={new Map([["agent_1", "Claude Code Agent"]])}
        claudeImports={[]}
        agentImports={[]}
      />
    </LangProvider>
  );
}

describe("Thread agent status", () => {
  it("renders dynamic status in streaming-status line", () => {
    renderThread({
      streamingTurns: [{
        turn_id: "turn_1",
        agent_id: "agent_1",
        text: "Working on it",
        phase: "reading_files",
        current: "Reading src/index.ts",
        metrics: { files_read: 3, searches: 0, commands: 0 }
      }]
    });

    const bubble = screen.getByText("Working on it").closest("article");
    expect(bubble).toHaveClass("streaming-bubble");

    const status = bubble?.querySelector(".streaming-status");
    expect(status).toHaveTextContent(/Reading files/i);
    expect(status).toHaveTextContent(/Reading src\/index\.ts/i);
    expect(status).toHaveTextContent(/已读 3 个文件/);
  });

  it("falls back to default streaming text when no status", () => {
    renderThread({
      streamingTurns: [{
        turn_id: "turn_1",
        agent_id: "agent_1",
        text: "Hello"
      }]
    });

    const bubble = screen.getByText("Hello").closest("article");
    const status = bubble?.querySelector(".streaming-status");
    expect(status).toHaveTextContent(/Agent responding/i);
  });

  it("renders failed state with error on same card", () => {
    renderThread({
      messages: [{
        message_id: "failed-turn_1",
        actor_id: "agent_1",
        text: "Partial output",
        kind: "agent",
        created_at: "2026-04-25T00:00:00.000Z",
        turnFailed: true,
        turnError: "command exited with code 1"
      }]
    });

    const card = screen.getByText("Partial output").closest("article");
    expect(card).toHaveClass("message--failed");
    expect(screen.getByText(/command exited with code 1/i)).toBeInTheDocument();
  });

  it("does not render raw thinking text when thinking text is present", () => {
    renderThread({
      streamingTurns: [{
        turn_id: "turn_1",
        agent_id: "agent_1",
        text: "Here is the answer",
        thinkingText: "Let me analyze the structure",
        thinkingDone: false
      }]
    });

    const bubble = screen.getByText("Here is the answer").closest("article");
    expect(bubble?.querySelector(".thinking-accordion")).not.toBeInTheDocument();
    expect(screen.queryByText("Let me analyze the structure")).not.toBeInTheDocument();
  });

  it("renders tool progress bar for reading_files phase", () => {
    renderThread({
      streamingTurns: [{
        turn_id: "turn_1",
        agent_id: "agent_1",
        text: "",
        phase: "reading_files",
        current: "Read src/App.tsx",
        detail: { elapsed_time_seconds: 3 }
      }]
    });

    const bubble = document.querySelector(".streaming-bubble");
    expect(bubble?.querySelector(".tool-progress-bar")).toBeInTheDocument();
  });

  it("renders memory recall pill for recalling_memory phase", () => {
    renderThread({
      streamingTurns: [{
        turn_id: "turn_1",
        agent_id: "agent_1",
        text: "",
        phase: "recalling_memory",
        current: "Recalling 3 memories",
        detail: { memory_count: 3 }
      }]
    });

    const bubble = screen.getByText(/Recalling 3 memories/i).closest("article");
    expect(bubble?.querySelector(".memory-recall-pill")).toBeInTheDocument();
  });

  it("renders turn summary footer for completed phase", () => {
    renderThread({
      streamingTurns: [{
        turn_id: "turn_1",
        agent_id: "agent_1",
        text: "Final answer",
        phase: "completed",
        current: "Claude Code completed in 12s",
        detail: { duration_ms: 12000, total_cost_usd: 0.0042, num_turns: 3, usage: { input_tokens: 1200, output_tokens: 800 } }
      }]
    });

    const bubble = screen.getByText("Final answer").closest("article");
    expect(bubble?.querySelector(".turn-summary-footer")).toBeInTheDocument();
  });
});
