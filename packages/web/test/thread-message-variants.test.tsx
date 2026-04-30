import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import Thread from "../src/components/Thread.js";
import { LangProvider } from "../src/i18n/LangProvider.js";

function renderThread(currentParticipantId = "user_1") {
  return render(
    <LangProvider>
      <Thread
        currentParticipantId={currentParticipantId}
        messages={[
          { message_id: "msg_1", actor_id: "user_1", text: "My note", kind: "human", created_at: "2026-04-30T00:00:00.000Z" },
          { message_id: "msg_2", actor_id: "user_2", text: "Other note", kind: "human", created_at: "2026-04-30T00:00:01.000Z" },
          { message_id: "msg_3", actor_id: "agent_1", text: "AI answer", kind: "agent", created_at: "2026-04-30T00:00:02.000Z" },
          { message_id: "msg_4", actor_id: "system", text: "History cleared", kind: "system", created_at: "2026-04-30T00:00:03.000Z" }
        ]}
        streamingTurns={[]}
        actorNames={new Map([["user_1", "Wei"], ["user_2", "Bob"], ["agent_1", "Claude Code Agent"]])}
        showSlowStreamingNotice={false}
        activeCollectionId={undefined}
        claudeImports={[]}
      />
    </LangProvider>
  );
}

describe("Thread message variants", () => {
  it("distinguishes own, other human, AI, and system messages", () => {
    renderThread();
    expect(screen.getByText("My note").closest("article")).toHaveClass("message-own");
    expect(screen.getByText("Other note").closest("article")).toHaveClass("message-human-other");
    expect(screen.getByText("AI answer").closest("article")).toHaveClass("message-ai-card");
    expect(screen.getByText("History cleared").closest("article")).toHaveClass("message-system-marker");
  });
});
