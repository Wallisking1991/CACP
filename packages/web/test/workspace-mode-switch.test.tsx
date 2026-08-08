import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceModeSwitch } from "../src/components/WorkspaceModeSwitch.js";
import { LangProvider } from "../src/i18n/LangProvider.js";

describe("WorkspaceModeSwitch", () => {
  it("renders icon-only tabs with accessible hover labels", () => {
    render(
      <LangProvider>
        <WorkspaceModeSwitch mode="conversation" onChange={vi.fn()} />
      </LangProvider>
    );

    const conversation = screen.getByRole("tab", {
      name: "Main conversation",
    });
    const whiteboard = screen.getByRole("tab", { name: "Whiteboard" });

    expect(conversation).toHaveAttribute("data-tooltip", "Main conversation");
    expect(whiteboard).toHaveAttribute("data-tooltip", "Whiteboard");
    expect(conversation).not.toHaveTextContent("Main conversation");
    expect(whiteboard).not.toHaveTextContent("Whiteboard");
    expect(conversation.querySelector("svg")).toBeInTheDocument();
    expect(whiteboard.querySelector("svg")).toBeInTheDocument();
    expect(conversation).toHaveAttribute("aria-selected", "true");
    expect(whiteboard).toHaveAttribute("aria-selected", "false");
  });

  it("warms the whiteboard on focus or pointer intent without changing modes", () => {
    const onChange = vi.fn();
    const onWhiteboardIntent = vi.fn();
    render(
      <LangProvider>
        <WorkspaceModeSwitch
          mode="conversation"
          onChange={onChange}
          onWhiteboardIntent={onWhiteboardIntent}
        />
      </LangProvider>
    );

    const whiteboard = screen.getByRole("tab", { name: "Whiteboard" });
    fireEvent.focus(whiteboard);
    fireEvent.pointerEnter(whiteboard);

    expect(onWhiteboardIntent).toHaveBeenCalledTimes(2);
    expect(onChange).not.toHaveBeenCalled();
    expect(whiteboard).toHaveAttribute("aria-selected", "false");
  });
});
