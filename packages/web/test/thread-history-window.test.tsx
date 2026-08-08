import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Thread from "../src/components/Thread.js";
import { LangProvider } from "../src/i18n/LangProvider.js";

describe("Thread history window", () => {
  const makeMessages = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      message_id: `msg_${index + 1}`,
      actor_id: "user_1",
      text: `Message ${index + 1}`,
      kind: "human" as const,
      created_at: new Date(Date.UTC(2026, 3, 30, 0, 0, index)).toISOString(),
    }));

  it("renders recent activity first and lets the participant reveal earlier messages", () => {
    const messages = makeMessages(150);

    render(
      <LangProvider>
        <Thread
          currentParticipantId="user_1"
          messages={messages}
          streamingTurns={[]}
          actorNames={new Map([["user_1", "Wei"]])}
        />
      </LangProvider>
    );

    expect(screen.queryByText("Message 1")).not.toBeInTheDocument();
    expect(screen.getByText("Message 150")).toBeInTheDocument();
    expect(document.querySelectorAll(".message")).toHaveLength(120);

    fireEvent.click(
      screen.getByRole("button", { name: "Show 30 earlier messages" })
    );

    expect(screen.getByText("Message 1")).toBeInTheDocument();
    expect(document.querySelectorAll(".message")).toHaveLength(150);
    expect(
      screen.queryByRole("button", { name: /earlier messages/i })
    ).not.toBeInTheDocument();
  });

  it("keeps the visible history anchored when a new message arrives", () => {
    const { container, rerender } = render(
      <LangProvider>
        <Thread
          currentParticipantId="user_1"
          messages={makeMessages(150)}
          streamingTurns={[]}
          actorNames={new Map([["user_1", "Wei"]])}
        />
      </LangProvider>
    );
    const thread = container.querySelector<HTMLElement>(".thread");
    if (!thread) throw new Error("thread was not rendered");
    Object.defineProperties(thread, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_000 },
    });
    thread.scrollTop = 100;
    fireEvent.scroll(thread);

    rerender(
      <LangProvider>
        <Thread
          currentParticipantId="user_1"
          messages={makeMessages(151)}
          streamingTurns={[]}
          actorNames={new Map([["user_1", "Wei"]])}
        />
      </LangProvider>
    );

    expect(screen.getByText("Message 31")).toBeInTheDocument();
    expect(screen.getByText("Message 151")).toBeInTheDocument();
    expect(document.querySelectorAll(".message")).toHaveLength(121);
    expect(
      screen.getByRole("button", { name: "Show 30 earlier messages" })
    ).toBeInTheDocument();
  });
});
