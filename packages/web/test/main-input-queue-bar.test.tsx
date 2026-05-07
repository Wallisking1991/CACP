import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { MainInputQueueBar } from "../src/components/MainInputQueueBar.js";
import type { MainInputQueueItemView } from "../src/room-state.js";

describe("MainInputQueueBar", () => {
  it("renders nothing when queue is empty", () => {
    const { container } = render(
      <MainInputQueueBar queue={[]} onCancel={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows single queued message with text and cancel button", () => {
    const queue: MainInputQueueItemView[] = [
      { input_id: "in1", text: "Hello Agent", status: "queued", created_at: "2026-05-02T00:00:00.000Z", actor_id: "p1" }
    ];
    render(<MainInputQueueBar queue={queue} onCancel={vi.fn()} />);
    expect(screen.getByText("Hello Agent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("shows collapsed summary when multiple messages are queued", () => {
    const queue: MainInputQueueItemView[] = [
      { input_id: "in1", text: "First message", status: "queued", created_at: "2026-05-02T00:00:00.000Z", actor_id: "p1" },
      { input_id: "in2", text: "Second message", status: "queued", created_at: "2026-05-02T00:00:01.000Z", actor_id: "p1" }
    ];
    render(<MainInputQueueBar queue={queue} onCancel={vi.fn()} />);
    expect(screen.getByText(/2/i)).toBeInTheDocument();
    expect(screen.queryByText("First message")).not.toBeInTheDocument();
    expect(screen.queryByText("Second message")).not.toBeInTheDocument();
  });

  it("expands to show individual messages when clicked", () => {
    const queue: MainInputQueueItemView[] = [
      { input_id: "in1", text: "First message", status: "queued", created_at: "2026-05-02T00:00:00.000Z", actor_id: "p1" },
      { input_id: "in2", text: "Second message", status: "queued", created_at: "2026-05-02T00:00:01.000Z", actor_id: "p1" }
    ];
    render(<MainInputQueueBar queue={queue} onCancel={vi.fn()} />);
    const summary = screen.getByText(/2/i);
    fireEvent.click(summary);
    expect(screen.getByText("First message")).toBeInTheDocument();
    expect(screen.getByText("Second message")).toBeInTheDocument();
  });

  it("calls onCancel with input_id when cancel button is clicked", () => {
    const onCancel = vi.fn();
    const queue: MainInputQueueItemView[] = [
      { input_id: "in1", text: "Hello", status: "queued", created_at: "2026-05-02T00:00:00.000Z", actor_id: "p1" }
    ];
    render(<MainInputQueueBar queue={queue} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledWith("in1");
  });

  it("shows accepted status for messages not yet queued", () => {
    const queue: MainInputQueueItemView[] = [
      { input_id: "in1", text: "Sending...", status: "accepted", created_at: "2026-05-02T00:00:00.000Z", actor_id: "p1" }
    ];
    render(<MainInputQueueBar queue={queue} onCancel={vi.fn()} />);
    expect(screen.getByText("Sending...")).toBeInTheDocument();
  });
});
