import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import MentionDropdown from "../src/components/MentionDropdown.js";

const items = [
  { id: "a1", name: "Claude Code", type: "agent" as const },
  { id: "a2", name: "Codex CLI", type: "agent" as const },
];

describe("MentionDropdown", () => {
  it("renders filtered items", () => {
    render(
      <MentionDropdown
        items={items}
        query="Claude"
        activeIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.queryByText("Codex CLI")).not.toBeInTheDocument();
  });

  it("calls onSelect when item is clicked", () => {
    const onSelect = vi.fn();
    render(
      <MentionDropdown
        items={items}
        query=""
        activeIndex={0}
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Claude Code"));
    expect(onSelect).toHaveBeenCalledWith("a1", "Claude Code");
  });

  it("highlights active item", () => {
    render(
      <MentionDropdown
        items={items}
        query=""
        activeIndex={1}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const active = screen.getByText("Codex CLI").closest("div");
    expect(active?.className).toContain("is-active");
  });
});
