import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import MainComposer from "../src/components/MainComposer.js";
import { LangProvider } from "../src/i18n/LangProvider.js";

function renderMainComposer(props: React.ComponentProps<typeof MainComposer>) {
  return render(
    <LangProvider>
      <MainComposer {...props} />
    </LangProvider>
  );
}

describe("MainComposer", () => {
  const noop = () => {};
  const baseProps = {
    role: "owner" as const,
    turnInFlight: false,
    agents: [{ agent_id: "a1", name: "Claude Code" }],
    onSendMainInput: vi.fn(),
    onTypingInput: noop,
    onStopTyping: noop,
  };

  it("renders textarea with Agent placeholder", () => {
    renderMainComposer(baseProps);
    expect(screen.getByPlaceholderText(/Type a message for the Agent/i)).toBeInTheDocument();
  });

  it("calls onSendMainInput on Enter", () => {
    const onSendMainInput = vi.fn();
    renderMainComposer({ ...baseProps, onSendMainInput });
    const textarea = screen.getByPlaceholderText(/Type a message for the Agent/i);
    fireEvent.change(textarea, { target: { value: "Hello Agent" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSendMainInput).toHaveBeenCalledWith("Hello Agent");
  });

  it("does not send on Shift+Enter", () => {
    const onSendMainInput = vi.fn();
    renderMainComposer({ ...baseProps, onSendMainInput });
    const textarea = screen.getByPlaceholderText(/Type a message for the Agent/i);
    fireEvent.change(textarea, { target: { value: "Hello Agent" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSendMainInput).not.toHaveBeenCalled();
  });

  it("shows Trigger Agent button", () => {
    renderMainComposer(baseProps);
    expect(screen.getByRole("button", { name: /Trigger Agent/i })).toBeInTheDocument();
  });

  it("calls onSendMainInput when button is clicked", () => {
    const onSendMainInput = vi.fn();
    renderMainComposer({ ...baseProps, onSendMainInput });
    const textarea = screen.getByPlaceholderText(/Type a message for the Agent/i);
    fireEvent.change(textarea, { target: { value: "Click test" } });
    fireEvent.click(screen.getByRole("button", { name: /Trigger Agent/i }));
    expect(onSendMainInput).toHaveBeenCalledWith("Click test");
  });

  it("disables textarea and button when agentReady is false", () => {
    renderMainComposer({ ...baseProps, agentReady: false });
    const textarea = screen.getByPlaceholderText(/Type a message for the Agent/i);
    expect(textarea).toBeDisabled();
    expect(screen.getByRole("button", { name: /Trigger Agent/i })).toBeDisabled();
  });

  it("keeps textarea and button enabled when agentReady is true", () => {
    renderMainComposer({ ...baseProps, agentReady: true });
    const textarea = screen.getByPlaceholderText(/Type a message for the Agent/i);
    fireEvent.change(textarea, { target: { value: "Hello" } });
    expect(textarea).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /Trigger Agent/i })).not.toBeDisabled();
  });
});
