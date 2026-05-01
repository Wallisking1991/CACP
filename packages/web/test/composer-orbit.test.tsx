import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import Composer from "../src/components/Composer.js";
import { LangProvider } from "../src/i18n/LangProvider.js";

function renderComposer(props: React.ComponentProps<typeof Composer>) {
  return render(
    <LangProvider>
      <Composer {...props} />
    </LangProvider>
  );
}

describe("Composer Orbit dual-send", () => {
  const noop = () => {};

  const baseProps = {
    role: "owner" as const,
    mode: "live" as const,
    turnInFlight: false,
    collectCount: 0,
    canSendMessages: true,
    pendingRoundtableRequest: false,
    onSend: noop,
    onToggleMode: noop,
    onSubmitCollection: noop,
    onCancelCollection: noop,
    onRequestRoundtable: noop,
    onTypingInput: noop,
    onStopTyping: noop,
    onClearConversation: noop,
  };

  it("shows single Send button when onSendOrbitNote is not provided", () => {
    renderComposer(baseProps);
    expect(screen.getByRole("button", { name: /Send/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Send to People/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Send to Agent/i })).not.toBeInTheDocument();
  });

  it("shows dual-send buttons when onSendOrbitNote is provided in live mode", () => {
    const onSendOrbitNote = vi.fn();
    renderComposer({ ...baseProps, onSendOrbitNote });

    expect(screen.queryByRole("button", { name: /Send$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send to People/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send to Agent/i })).toBeInTheDocument();
  });

  it("calls onSendOrbitNote when Send to People is clicked", () => {
    const onSendOrbitNote = vi.fn();
    renderComposer({ ...baseProps, onSendOrbitNote });

    const textarea = screen.getByPlaceholderText(/Type a message/i);
    fireEvent.change(textarea, { target: { value: "orbit note" } });
    fireEvent.click(screen.getByRole("button", { name: /Send to People/i }));

    expect(onSendOrbitNote).toHaveBeenCalledWith("orbit note");
  });

  it("calls onSend when Send to Agent is clicked", () => {
    const onSend = vi.fn();
    const onSendOrbitNote = vi.fn();
    renderComposer({ ...baseProps, onSend, onSendOrbitNote });

    const textarea = screen.getByPlaceholderText(/Type a message/i);
    fireEvent.change(textarea, { target: { value: "agent message" } });
    fireEvent.click(screen.getByRole("button", { name: /Send to Agent/i }));

    expect(onSend).toHaveBeenCalledWith("agent message");
    expect(onSendOrbitNote).not.toHaveBeenCalled();
  });

  it("clears textarea after sending via either button", () => {
    const onSendOrbitNote = vi.fn();
    renderComposer({ ...baseProps, onSendOrbitNote });

    const textarea = screen.getByPlaceholderText(/Type a message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "test" } });
    fireEvent.click(screen.getByRole("button", { name: /Send to People/i }));

    expect(textarea.value).toBe("");
  });

  it("falls back to single Send when onSendOrbitNote is undefined", () => {
    renderComposer({ ...baseProps, onSendOrbitNote: undefined });
    expect(screen.getByRole("button", { name: /Send/i })).toBeInTheDocument();
  });

  it("disables both dual-send buttons when textarea is empty", () => {
    const onSendOrbitNote = vi.fn();
    renderComposer({ ...baseProps, onSendOrbitNote });

    expect(screen.getByRole("button", { name: /Send to People/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Send to Agent/i })).toBeDisabled();
  });

  it("shows Queue button (not dual-send) when turnInFlight", () => {
    const onSendOrbitNote = vi.fn();
    renderComposer({ ...baseProps, turnInFlight: true, onSendOrbitNote });

    expect(screen.queryByRole("button", { name: /Send to People/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Send to Agent/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Queue message/i })).toBeInTheDocument();
  });

  it("does not show dual-send in collect mode", () => {
    const onSendOrbitNote = vi.fn();
    renderComposer({ ...baseProps, mode: "collect", onSendOrbitNote });

    expect(screen.queryByRole("button", { name: /Send to People/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Send to Agent/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add/i })).toBeInTheDocument();
  });
});
