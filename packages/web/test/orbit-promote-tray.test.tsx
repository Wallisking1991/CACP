import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { OrbitPromoteTray } from "../src/components/OrbitPromoteTray.js";
import { LangProvider } from "../src/i18n/LangProvider.js";

function renderTray(props: React.ComponentProps<typeof OrbitPromoteTray>) {
  return render(
    <LangProvider>
      <OrbitPromoteTray {...props} />
    </LangProvider>
  );
}

describe("OrbitPromoteTray", () => {
  const baseProps = {
    notes: [],
    onPromote: vi.fn(),
    canPromote: true,
  };

  it("shows empty state when no notes", () => {
    renderTray(baseProps);
    expect(screen.getByText(/No notes to promote/i)).toBeInTheDocument();
  });

  it("renders selectable note items", () => {
    const notes = [
      { note_id: "note_1", text: "Promote me", created_by: "user_1", created_at: "2026-04-25T00:00:00.000Z", likes: 0, liked_by_me: false }
    ];
    renderTray({ ...baseProps, notes });

    expect(screen.getByText("Promote me")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("selects and deselects notes on checkbox click", () => {
    const notes = [
      { note_id: "note_1", text: "Note 1", created_by: "user_1", created_at: "2026-04-25T00:00:00.000Z", likes: 0, liked_by_me: false },
      { note_id: "note_2", text: "Note 2", created_by: "user_2", created_at: "2026-04-25T00:00:01.000Z", likes: 0, liked_by_me: false }
    ];
    renderTray({ ...baseProps, notes });

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);

    fireEvent.click(checkboxes[0]);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();

    fireEvent.click(checkboxes[0]);
    expect(checkboxes[0]).not.toBeChecked();
  });

  it("calls onPromote with selected note ids when Promote button clicked", () => {
    const onPromote = vi.fn();
    const notes = [
      { note_id: "note_1", text: "Note 1", created_by: "user_1", created_at: "2026-04-25T00:00:00.000Z", likes: 0, liked_by_me: false },
      { note_id: "note_2", text: "Note 2", created_by: "user_2", created_at: "2026-04-25T00:00:01.000Z", likes: 0, liked_by_me: false }
    ];
    renderTray({ ...baseProps, notes, onPromote });

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    fireEvent.click(screen.getByRole("button", { name: /Promote/i }));
    expect(onPromote).toHaveBeenCalledWith(["note_1", "note_2"]);
  });

  it("disables promote button when no notes selected", () => {
    const notes = [
      { note_id: "note_1", text: "Note 1", created_by: "user_1", created_at: "2026-04-25T00:00:00.000Z", likes: 0, liked_by_me: false }
    ];
    renderTray({ ...baseProps, notes });

    expect(screen.getByRole("button", { name: /Promote/i })).toBeDisabled();
  });

  it("disables controls when canPromote is false", () => {
    const notes = [
      { note_id: "note_1", text: "Note 1", created_by: "user_1", created_at: "2026-04-25T00:00:00.000Z", likes: 0, liked_by_me: false }
    ];
    renderTray({ ...baseProps, notes, canPromote: false });

    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Promote/i })).toBeDisabled();
  });

  it("clears selection after successful promote", () => {
    const onPromote = vi.fn();
    const notes = [
      { note_id: "note_1", text: "Note 1", created_by: "user_1", created_at: "2026-04-25T00:00:00.000Z", likes: 0, liked_by_me: false }
    ];
    renderTray({ ...baseProps, notes, onPromote });

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: /Promote/i }));
    expect(checkbox).not.toBeChecked();
  });
});
