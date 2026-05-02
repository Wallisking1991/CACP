import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { OrbitPromoteModal } from "../src/components/OrbitPromoteModal.js";
import { LangProvider } from "../src/i18n/LangProvider.js";

function renderModal(props: React.ComponentProps<typeof OrbitPromoteModal>) {
  return render(
    <LangProvider>
      <OrbitPromoteModal {...props} />
    </LangProvider>
  );
}

const sampleNotes = [
  { note_id: "note_1", text: "First note", created_by: "user_1", created_at: "2026-04-25T00:00:00.000Z", likes: 0, liked_by_me: false },
  { note_id: "note_2", text: "Second note", created_by: "user_2", created_at: "2026-04-25T00:00:01.000Z", likes: 0, liked_by_me: false },
];

describe("OrbitPromoteModal", () => {
  const baseProps = {
    open: true,
    notes: sampleNotes,
    canPromote: true,
    onPromote: vi.fn(),
    onClose: vi.fn(),
  };

  it("does not render when open is false", () => {
    renderModal({ ...baseProps, open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders dialog with title and selectable notes when open", () => {
    renderModal(baseProps);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Promote to Main Thread/i)).toBeInTheDocument();
    expect(screen.getByText("First note")).toBeInTheDocument();
    expect(screen.getByText("Second note")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("shows empty state when notes is empty", () => {
    renderModal({ ...baseProps, notes: [] });
    expect(screen.getByText(/No notes to promote/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("Promote button is disabled when nothing selected", () => {
    renderModal(baseProps);
    expect(screen.getByRole("button", { name: /^Promote$/i })).toBeDisabled();
  });

  it("calls onPromote with selected note ids and closes dialog", () => {
    const onPromote = vi.fn();
    const onClose = vi.fn();
    renderModal({ ...baseProps, onPromote, onClose });
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole("button", { name: /^Promote$/i }));
    expect(onPromote).toHaveBeenCalledWith(["note_1", "note_2"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when Cancel button is clicked without calling onPromote", () => {
    const onPromote = vi.fn();
    const onClose = vi.fn();
    renderModal({ ...baseProps, onPromote, onClose });
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onPromote).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when X close button is clicked", () => {
    const onClose = vi.fn();
    renderModal({ ...baseProps, onClose });
    fireEvent.click(screen.getByRole("button", { name: /Close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when Escape is pressed", () => {
    const onClose = vi.fn();
    renderModal({ ...baseProps, onClose });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when overlay is clicked", () => {
    const onClose = vi.fn();
    renderModal({ ...baseProps, onClose });
    const overlay = document.querySelector(".orbit-promote-modal-overlay") as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close when dialog content is clicked", () => {
    const onClose = vi.fn();
    renderModal({ ...baseProps, onClose });
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("disables checkboxes and promote when canPromote is false", () => {
    renderModal({ ...baseProps, canPromote: false });
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: /^Promote$/i })).toBeDisabled();
  });
});
