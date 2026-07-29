import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { AgentRunInteractionCard } from "../src/components/AgentRunInteractionCard.js";
import type { AgentRunNodeView } from "../src/room-state.js";

function makeNode(overrides: Partial<AgentRunNodeView> = {}): AgentRunNodeView {
  return {
    run_id: "run_1",
    turn_id: "turn_1",
    agent_id: "agent_1",
    provider: "kimi-cli",
    node_id: "node_1",
    kind: "approval",
    status: "waiting_input",
    title: "Test",
    text_chunks: [],
    stdout_chunks: [],
    stderr_chunks: [],
    started_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("AgentRunInteractionCard", () => {
  it("renders approval buttons for approval nodes", () => {
    const node = makeNode({ kind: "approval" });
    const onResolveApproval = vi.fn();
    render(
      <AgentRunInteractionCard
        runId="run_1"
        node={node}
        onResolveApproval={onResolveApproval}
      />
    );
    fireEvent.click(screen.getByText("Allow"));
    expect(onResolveApproval).toHaveBeenCalledWith("run_1", "node_1", "allow");
  });

  it("renders default elicitation buttons when no questions present", () => {
    const node = makeNode({ kind: "elicitation" });
    const onResolveElicitation = vi.fn();
    render(
      <AgentRunInteractionCard
        runId="run_1"
        node={node}
        onResolveElicitation={onResolveElicitation}
      />
    );
    fireEvent.click(screen.getByText("Accept"));
    expect(onResolveElicitation).toHaveBeenCalledWith(
      "run_1",
      "node_1",
      "accept",
      {}
    );
  });

  it("renders Kimi question options and submits answers", () => {
    const node = makeNode({
      kind: "elicitation",
      detail: {
        questions: [
          {
            question: "Should I proceed?",
            options: [
              { label: "yes", description: "Proceed" },
              { label: "no", description: "Cancel" },
            ],
            multi_select: false,
          },
        ],
      },
    });
    const onResolveElicitation = vi.fn();
    render(
      <AgentRunInteractionCard
        runId="run_1"
        node={node}
        onResolveElicitation={onResolveElicitation}
      />
    );

    expect(screen.getByText("Should I proceed?")).toBeInTheDocument();
    expect(screen.getByText("yes")).toBeInTheDocument();
    expect(screen.getByText("no")).toBeInTheDocument();

    fireEvent.click(screen.getByText("yes"));
    fireEvent.click(screen.getByText("Submit"));

    expect(onResolveElicitation).toHaveBeenCalledWith(
      "run_1",
      "node_1",
      "accept",
      { answers: { "0": "yes" } }
    );
  });

  it("renders text input for question without options", () => {
    const node = makeNode({
      kind: "elicitation",
      detail: {
        questions: [
          {
            question: "What is your name?",
            options: [],
          },
        ],
      },
    });
    const onResolveElicitation = vi.fn();
    render(
      <AgentRunInteractionCard
        runId="run_1"
        node={node}
        onResolveElicitation={onResolveElicitation}
      />
    );

    expect(screen.getByText("What is your name?")).toBeInTheDocument();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Alice" } });
    fireEvent.click(screen.getByText("Submit"));

    expect(onResolveElicitation).toHaveBeenCalledWith(
      "run_1",
      "node_1",
      "accept",
      { answers: { "0": "Alice" } }
    );
  });
});
