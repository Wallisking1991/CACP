import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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

describe("Composer icon-only layout", () => {
  const noop = () => {};
  const baseProps = {
    role: "owner" as const,
    turnInFlight: false,
    onSend: noop,
    onTypingInput: noop,
    onStopTyping: noop,
    onClearConversation: noop,
  };

  it("renders the textarea before the action bar (no row above textarea)", () => {
    renderComposer(baseProps);
    const composer = document.querySelector(".composer");
    expect(composer).not.toBeNull();
    const children = Array.from(composer!.children);
    const textareaIdx = children.findIndex((el) => el.tagName === "TEXTAREA");
    const actionBarIdx = children.findIndex((el) => el.classList.contains("composer-action-bar"));
    expect(textareaIdx).toBeGreaterThanOrEqual(0);
    expect(actionBarIdx).toBeGreaterThan(textareaIdx);
  });

  it("does not render any .status-strip element when queued", () => {
    renderComposer({ ...baseProps, turnInFlight: true });
    expect(document.querySelector(".status-strip")).toBeNull();
  });

  it("does not render the queuedHint text when queued (icon-only state)", () => {
    renderComposer({ ...baseProps, turnInFlight: true });
    expect(screen.queryByText(/AI is replying/i)).toBeNull();
    expect(screen.queryByText(/AI 正在回复/)).toBeNull();
  });

  it("places the owner sweep button inside the action bar (not above the textarea)", () => {
    renderComposer({ ...baseProps, role: "owner" });
    const sweepButton = screen.getByRole("button", { name: /Clear conversation/i });
    const actionBar = sweepButton.closest(".composer-action-bar");
    expect(actionBar).not.toBeNull();
    const composer = document.querySelector(".composer");
    const textarea = composer!.querySelector("textarea");
    expect(textarea!.compareDocumentPosition(actionBar!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the queued send button with both SendIcon and a ClockIcon badge", () => {
    renderComposer({ ...baseProps, turnInFlight: true });
    const queueButton = screen.getByRole("button", { name: /Queue/i });
    const stack = queueButton.querySelector(".composer-icon-stack");
    expect(stack).not.toBeNull();
    const badge = stack!.querySelector(".composer-icon-stack__badge");
    expect(badge).not.toBeNull();
  });

  it("renders confirm-clear dialog with two icon buttons (cancel + confirm) and no visible text labels on them", () => {
    renderComposer({ ...baseProps, role: "owner" });
    const sweepButton = screen.getByRole("button", { name: /Clear conversation/i });
    sweepButton.click();
    const cancelButton = screen.getByRole("button", { name: /Cancel/i });
    const confirmButton = screen.getByRole("button", { name: /Confirm clear conversation/i });
    expect(cancelButton.textContent?.trim()).toBe("");
    expect(confirmButton.textContent?.trim()).toBe("");
    expect(cancelButton.querySelector("svg")).not.toBeNull();
    expect(confirmButton.querySelector("svg")).not.toBeNull();
  });

  it("renders all action-bar buttons as icon-only (no visible text content)", () => {
    renderComposer({ ...baseProps, role: "owner", onSendOrbitNote: noop });
    const buttons = document.querySelectorAll(".composer-action-bar button");
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((btn) => {
      expect(btn.textContent?.trim()).toBe("");
      expect(btn.querySelector("svg")).not.toBeNull();
    });
  });
});
