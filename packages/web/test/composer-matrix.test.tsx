import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

describe("Composer render matrix", () => {
  const noop = () => {};

  const baseProps = {
    role: "owner" as const,
    turnInFlight: false,
    onSend: noop,
    onTypingInput: noop,
    onStopTyping: noop,
    onClearConversation: noop,
  };

  it("renders textarea and Send button for owner in live mode", () => {
    renderComposer({ ...baseProps });

    const composer = document.querySelector(".composer");
    expect(composer).not.toBeNull();
    expect(composer!.classList.contains("composer-queued")).toBe(false);

    expect(screen.getByRole("button", { name: /Send/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Type a message/i)).toBeInTheDocument();
  });

  it("shows Queue button and queued surface when turnInFlight", () => {
    renderComposer({ ...baseProps, turnInFlight: true });

    const composer = document.querySelector(".composer-queued");
    expect(composer).not.toBeNull();

    expect(screen.getByRole("button", { name: /Queue/i })).toBeInTheDocument();
  });

  it("calls onSend when Send is clicked", () => {
    const onSend = vi.fn();
    renderComposer({ ...baseProps, onSend });

    const textarea = screen.getByPlaceholderText(/Type a message/i);
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));

    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("shows owner-only clear conversation icon and confirms before clearing", () => {
    const onClearConversation = vi.fn();
    renderComposer({ ...baseProps, role: "owner", onClearConversation });

    fireEvent.click(screen.getByRole("button", { name: /Clear conversation/i }));
    expect(screen.getByText(/Clear the visible conversation history/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Confirm clear conversation/i }));
    expect(onClearConversation).toHaveBeenCalledTimes(1);
  });

  it("hides clear conversation action for members", () => {
    renderComposer({ ...baseProps, role: "member" });
    expect(screen.queryByRole("button", { name: /Clear conversation/i })).not.toBeInTheDocument();
  });

  it("notifies typing callbacks on input and send", () => {
    const onTypingInput = vi.fn();
    const onStopTyping = vi.fn();
    const onSend = vi.fn();
    renderComposer({ ...baseProps, onTypingInput, onStopTyping, onSend });

    const textarea = screen.getByPlaceholderText(/Type a message/i);
    fireEvent.change(textarea, { target: { value: "hello" } });
    expect(onTypingInput).toHaveBeenCalledWith("hello");
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    expect(onSend).toHaveBeenCalledWith("hello");
    expect(onStopTyping).toHaveBeenCalledTimes(1);
  });

  it("disables input for observer", () => {
    renderComposer({ ...baseProps, role: "observer" });

    const textarea = screen.getByPlaceholderText(/Type a message/i);
    expect(textarea).toBeDisabled();
  });
});
