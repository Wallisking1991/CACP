import { describe, expect, it, beforeAll, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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
    mode: "live" as const,
    turnInFlight: false,
    collectCount: 0,
    canSendMessages: true,
    onSend: noop,
    onToggleMode: noop,
    onSubmitCollection: noop,
    onCancelCollection: noop,
  };

  describe("Live mode", () => {
    it("renders warm surface, hint, textarea and Send button for owner", () => {
      renderComposer({ ...baseProps, role: "owner" });

      const composer = document.querySelector(".composer");
      expect(composer).not.toBeNull();
      expect(composer!.classList.contains("composer-collect")).toBe(false);
      expect(composer!.classList.contains("composer-queued")).toBe(false);

      expect(screen.getByText("Each message goes to AI immediately")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Send/i })).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Type a message/i)).toBeInTheDocument();
    });

    it("has enabled mode toggle for owner", () => {
      renderComposer({ ...baseProps, role: "owner" });

      const liveBtn = screen.getByRole("button", { name: /Live/i });
      const collectBtn = screen.getByRole("button", { name: /Collect/i });
      expect(liveBtn).not.toBeDisabled();
      expect(collectBtn).not.toBeDisabled();
    });

    it("has disabled mode toggle for non-owner", () => {
      renderComposer({ ...baseProps, role: "member" });

      const liveBtn = screen.getByRole("button", { name: /Live/i });
      const collectBtn = screen.getByRole("button", { name: /Collect/i });
      expect(liveBtn).toBeDisabled();
      expect(collectBtn).toBeDisabled();
    });

    it("shows Queue button and queued surface when turnInFlight", () => {
      renderComposer({ ...baseProps, turnInFlight: true });

      const composer = document.querySelector(".composer-queued");
      expect(composer).not.toBeNull();

      expect(screen.getByText(/Claude is replying/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Queue/i })).toBeInTheDocument();
    });

    it("disables mode toggle for everyone while turnInFlight", () => {
      renderComposer({ ...baseProps, role: "owner", turnInFlight: true });

      const liveBtn = screen.getByRole("button", { name: /Live/i });
      const collectBtn = screen.getByRole("button", { name: /Collect/i });
      expect(liveBtn).toBeDisabled();
      expect(collectBtn).toBeDisabled();
    });

    it("disables input for observer even in live mode", () => {
      renderComposer({ ...baseProps, role: "observer" });

      const textarea = screen.getByPlaceholderText(/Type a message/i);
      expect(textarea).toBeDisabled();
    });

    it("calls onSend when Send is clicked", () => {
      const onSend = vi.fn();
      renderComposer({ ...baseProps, onSend });

      const textarea = screen.getByPlaceholderText(/Type a message/i);
      fireEvent.change(textarea, { target: { value: "hello" } });
      fireEvent.click(screen.getByRole("button", { name: /Send/i }));

      expect(onSend).toHaveBeenCalledWith("hello");
    });
  });

  describe("Collect mode", () => {
    it("renders collect surface, Add button, and owner action row for owner", () => {
      renderComposer({ ...baseProps, role: "owner", mode: "collect", collectCount: 2 });

      const composer = document.querySelector(".composer-collect");
      expect(composer).not.toBeNull();

      expect(screen.getByRole("button", { name: /Add/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Cancel collection/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Submit 2 answers/i })).toBeInTheDocument();
    });

    it("shows collect badge with count for owner", () => {
      renderComposer({ ...baseProps, role: "owner", mode: "collect", collectCount: 3 });

      expect(screen.getByText("3")).toBeInTheDocument();
      expect(screen.getByText(/Collecting answers/i)).toBeInTheDocument();
    });

    it("disables submit when collectCount is 0", () => {
      renderComposer({ ...baseProps, role: "owner", mode: "collect", collectCount: 0 });

      expect(screen.getByRole("button", { name: /Submit/i })).toBeDisabled();
    });

    it("shows member hint and no action row for member", () => {
      renderComposer({ ...baseProps, role: "member", mode: "collect", collectCount: 1 });

      expect(screen.getByText(/Owner is collecting answers/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Cancel collection/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Submit/i })).not.toBeInTheDocument();
    });

    it("shows member hint and disabled input for observer", () => {
      renderComposer({ ...baseProps, role: "observer", mode: "collect", collectCount: 1 });

      expect(screen.getByText(/Owner is collecting answers/i)).toBeInTheDocument();
      const textarea = screen.getByPlaceholderText(/Type a message/i);
      expect(textarea).toBeDisabled();
    });

    it("disables toggle for non-owner in collect mode", () => {
      renderComposer({ ...baseProps, role: "member", mode: "collect" });

      const liveBtn = screen.getByRole("button", { name: /Live/i });
      const collectBtn = screen.getByRole("button", { name: /Collect/i });
      expect(liveBtn).toBeDisabled();
      expect(collectBtn).toBeDisabled();
    });

    it("calls onToggleMode when owner clicks Live in collect mode", () => {
      const onToggleMode = vi.fn();
      renderComposer({ ...baseProps, role: "owner", mode: "collect", onToggleMode });

      fireEvent.click(screen.getByRole("button", { name: /Live/i }));
      expect(onToggleMode).toHaveBeenCalled();
    });

    it("calls onToggleMode when owner clicks Collect in live mode", () => {
      const onToggleMode = vi.fn();
      renderComposer({ ...baseProps, role: "owner", mode: "live", onToggleMode });

      fireEvent.click(screen.getByRole("button", { name: /Collect/i }));
      expect(onToggleMode).toHaveBeenCalled();
    });

    it("calls onSubmitCollection when owner clicks Submit", () => {
      const onSubmitCollection = vi.fn();
      renderComposer({ ...baseProps, role: "owner", mode: "collect", collectCount: 2, onSubmitCollection });

      fireEvent.click(screen.getByRole("button", { name: /Submit 2 answers/i }));
      expect(onSubmitCollection).toHaveBeenCalled();
    });

    it("calls onCancelCollection when owner clicks Cancel", () => {
      const onCancelCollection = vi.fn();
      renderComposer({ ...baseProps, role: "owner", mode: "collect", collectCount: 1, onCancelCollection });

      fireEvent.click(screen.getByRole("button", { name: /Cancel collection/i }));
      expect(onCancelCollection).toHaveBeenCalled();
    });
  });

  describe("Admin role", () => {
    it("can send messages in live mode but cannot toggle mode", () => {
      renderComposer({ ...baseProps, role: "admin" });

      const textarea = screen.getByPlaceholderText(/Type a message/i);
      expect(textarea).not.toBeDisabled();
      expect(screen.getByRole("button", { name: /Send/i })).toBeInTheDocument();

      const liveBtn = screen.getByRole("button", { name: /Live/i });
      expect(liveBtn).toBeDisabled();
    });
  });

  describe("Agent role", () => {
    it("cannot send messages and toggle is disabled", () => {
      renderComposer({ ...baseProps, role: "agent", canSendMessages: false });

      const textarea = screen.getByPlaceholderText(/Type a message/i);
      expect(textarea).toBeDisabled();

      const liveBtn = screen.getByRole("button", { name: /Live/i });
      expect(liveBtn).toBeDisabled();
    });
  });
});
