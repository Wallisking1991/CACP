import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import OrbitComposer from "../src/components/OrbitComposer.js";
import { LangProvider } from "../src/i18n/LangProvider.js";

function renderOrbitComposer(props: React.ComponentProps<typeof OrbitComposer>) {
  return render(
    <LangProvider>
      <OrbitComposer {...props} />
    </LangProvider>
  );
}

describe("OrbitComposer", () => {
  const noop = () => {};
  const baseProps = {
    role: "member" as const,
    members: [
      { id: "p1", display_name: "Alice", role: "owner" },
      { id: "p2", display_name: "Bob", role: "member" },
    ],
    onSendOrbitNote: vi.fn(),
    onTypingInput: noop,
    onStopTyping: noop,
  };

  it("renders textarea with orbit placeholder", () => {
    renderOrbitComposer(baseProps);
    expect(screen.getByPlaceholderText(/Chat with the team/i)).toBeInTheDocument();
  });

  it("calls onSendOrbitNote on Enter", () => {
    const onSendOrbitNote = vi.fn();
    renderOrbitComposer({ ...baseProps, onSendOrbitNote });
    const textarea = screen.getByPlaceholderText(/Chat with the team/i);
    fireEvent.change(textarea, { target: { value: "Hey team" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSendOrbitNote).toHaveBeenCalledWith("Hey team");
  });

  it("does not send on Shift+Enter", () => {
    const onSendOrbitNote = vi.fn();
    renderOrbitComposer({ ...baseProps, onSendOrbitNote });
    const textarea = screen.getByPlaceholderText(/Chat with the team/i);
    fireEvent.change(textarea, { target: { value: "Hey team" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSendOrbitNote).not.toHaveBeenCalled();
  });

  it("shows Send button", () => {
    renderOrbitComposer(baseProps);
    expect(screen.getByRole("button", { name: /Send/i })).toBeInTheDocument();
  });
});
