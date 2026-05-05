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
});
