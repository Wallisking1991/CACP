import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import Thread from "../src/components/Thread.js";
import type { MessageView, StreamingTurnView } from "../src/room-state.js";

function renderThread(messages: MessageView[], pendingAgentName?: string) {
  return render(
    <Thread
      currentParticipantId="p1"
      messages={messages}
      streamingTurns={[]}
      actorNames={new Map()}
      pendingAgentName={pendingAgentName}
    />
  );
}

describe("Thread queued messages", () => {
  it("renders queued message with dashed border style", () => {
    const messages: MessageView[] = [{
      message_id: "in1",
      actor_id: "p1",
      text: "Hello Agent",
      kind: "queued",
      created_at: "2026-05-02T00:00:00.000Z"
    }];
    renderThread(messages);
    const msg = screen.getByText("Hello Agent");
    expect(msg).toBeInTheDocument();
    const article = msg.closest("article");
    expect(article?.className).toContain("message-queued");
  });

  it("shows 'QUEUED' label for queued messages", () => {
    const messages: MessageView[] = [{
      message_id: "in1",
      actor_id: "p1",
      text: "Hello",
      kind: "queued",
      created_at: "2026-05-02T00:00:00.000Z"
    }];
    renderThread(messages);
    expect(screen.getByText(/QUEUED/i)).toBeInTheDocument();
  });

  it("renders skeleton bubble when pendingAgentName is provided", () => {
    renderThread([], "Claude Code");
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(document.querySelector(".skeleton-bubble")).toBeInTheDocument();
  });

  it("does not render skeleton bubble when pendingAgentName is absent", () => {
    renderThread([]);
    expect(document.querySelector(".skeleton-bubble")).not.toBeInTheDocument();
  });
});
