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
    turnInFlight: false,
    onSend: noop,
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

  it("shows dual-send buttons when onSendOrbitNote is provided", () => {
    const onSendOrbitNote = vi.fn();
    renderComposer({ ...baseProps, onSendOrbitNote });

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

  it("calls onSendMainInput when Send to Agent is clicked (when provided)", () => {
    const onSend = vi.fn();
    const onSendOrbitNote = vi.fn();
    const onSendMainInput = vi.fn();
    renderComposer({ ...baseProps, onSend, onSendOrbitNote, onSendMainInput });

    const textarea = screen.getByPlaceholderText(/Type a message/i);
    fireEvent.change(textarea, { target: { value: "agent message" } });
    fireEvent.click(screen.getByRole("button", { name: /Send to Agent/i }));

    expect(onSendMainInput).toHaveBeenCalledWith("agent message");
    expect(onSendOrbitNote).not.toHaveBeenCalled();
  });

  it("falls back to onSend when Send to Agent is clicked without onSendMainInput", () => {
    const onSend = vi.fn();
    const onSendOrbitNote = vi.fn();
    renderComposer({ ...baseProps, onSend, onSendOrbitNote });

    const textarea = screen.getByPlaceholderText(/Type a message/i);
    fireEvent.change(textarea, { target: { value: "agent fallback" } });
    fireEvent.click(screen.getByRole("button", { name: /Send to Agent/i }));

    expect(onSend).toHaveBeenCalledWith("agent fallback");
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
    expect(screen.getByRole("button", { name: /Queue/i })).toBeInTheDocument();
  });

  it("calls onSendMainInput when Queue is clicked during turnInFlight", () => {
    const onSendMainInput = vi.fn();
    renderComposer({ ...baseProps, turnInFlight: true, onSendMainInput });

    const textarea = screen.getByPlaceholderText(/Type a message/i);
    fireEvent.change(textarea, { target: { value: "queued input" } });
    fireEvent.click(screen.getByRole("button", { name: /Queue/i }));

    expect(onSendMainInput).toHaveBeenCalledWith("queued input");
  });

  it("falls back to onSend when Queue is clicked without onSendMainInput", () => {
    const onSend = vi.fn();
    renderComposer({ ...baseProps, turnInFlight: true, onSend });

    const textarea = screen.getByPlaceholderText(/Type a message/i);
    fireEvent.change(textarea, { target: { value: "queued fallback" } });
    fireEvent.click(screen.getByRole("button", { name: /Queue/i }));

    expect(onSend).toHaveBeenCalledWith("queued fallback");
  });
});
