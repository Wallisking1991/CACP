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
  { note_id: "note_1", text: "First note", created_by: "user_1", created_at: "2026-04-25T00:00:00.000Z", likes: 0, liked_by_me: false, quoted: false },
  { note_id: "note_2", text: "Second note", created_by: "user_2", created_at: "2026-04-25T00:00:01.000Z", likes: 0, liked_by_me: false, quoted: false },
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

  it("renders notes in descending chronological order (newest first)", () => {
    renderModal(baseProps);
    const items = screen.getAllByRole("listitem");
    expect(items[0].textContent).toContain("Second note");
    expect(items[1].textContent).toContain("First note");
  });

  it("shows empty state when notes is empty", () => {
    renderModal({ ...baseProps, notes: [] });
    expect(screen.getByText(/No notes to promote/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("selects all notes by default and toggles select all", () => {
    const onPromote = vi.fn();
    renderModal({ ...baseProps, onPromote });
    expect(screen.getAllByRole("checkbox").every((checkbox) => (checkbox as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Deselect all/i }));
    expect(screen.getByRole("button", { name: /^Promote$/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Select all/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Promote$/i }));
    expect(onPromote).toHaveBeenCalledWith(["note_1", "note_2"]);
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

  it("preserves user deselections when parent re-renders with a new notes array of the same ids", () => {
    const onPromote = vi.fn();
    const { rerender } = render(
      <LangProvider>
        <OrbitPromoteModal {...baseProps} notes={sampleNotes} onPromote={onPromote} />
      </LangProvider>
    );
    // Both selected by default.
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes.every((c) => c.checked)).toBe(true);

    // User deselects the first visible note (note_2, the most recent, now at the top).
    fireEvent.click(checkboxes[0]);
    expect((screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(false);
    expect((screen.getAllByRole("checkbox")[1] as HTMLInputElement).checked).toBe(true);

    // Parent re-derives a new notes array reference with the same ids (e.g. WebSocket tick).
    const reDerivedNotes = sampleNotes.map((note) => ({ ...note }));
    rerender(
      <LangProvider>
        <OrbitPromoteModal {...baseProps} notes={reDerivedNotes} onPromote={onPromote} />
      </LangProvider>
    );

    // User's deselection must survive.
    const refreshed = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(refreshed[0].checked).toBe(false);
    expect(refreshed[1].checked).toBe(true);

    // Promote should call with only the still-selected note (note_1, in original ascending order).
    fireEvent.click(screen.getByRole("button", { name: /^Promote$/i }));
    expect(onPromote).toHaveBeenCalledWith(["note_1"]);
  });
});
