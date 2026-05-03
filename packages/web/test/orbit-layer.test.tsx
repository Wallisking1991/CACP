import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { OrbitLayer } from "../src/components/OrbitLayer.js";
import { LangProvider } from "../src/i18n/LangProvider.js";

function renderOrbitLayer(props: React.ComponentProps<typeof OrbitLayer>) {
  return render(
    <LangProvider>
      <OrbitLayer {...props} />
    </LangProvider>
  );
}

describe("OrbitLayer", () => {
  const baseProps = {
    notes: [],
    currentParticipantId: "user_1",
    actorNames: new Map<string, string>([["user_1", "Alice"], ["user_2", "Bob"]]),
    onLike: vi.fn(),
    onUnlike: vi.fn(),
  };

  it("renders empty state when no notes", () => {
    renderOrbitLayer(baseProps);
    expect(screen.getByText(/No orbit notes yet/i)).toBeInTheDocument();
  });

  it("renders orbit notes with text and author", () => {
    const notes = [
      { note_id: "note_1", text: "Hello orbit", created_by: "user_1", created_at: "2026-04-25T00:00:00.000Z", likes: 0, liked_by_me: false, quoted: false }
    ];
    renderOrbitLayer({ ...baseProps, notes });

    expect(screen.getByText("Hello orbit")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("shows like count and calls onLike when like button clicked", () => {
    const onLike = vi.fn();
    const notes = [
      { note_id: "note_1", text: "Note text", created_by: "user_2", created_at: "2026-04-25T00:00:00.000Z", likes: 2, liked_by_me: false, quoted: false }
    ];
    renderOrbitLayer({ ...baseProps, notes, onLike });

    expect(screen.getByText("2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Like/i }));
    expect(onLike).toHaveBeenCalledWith("note_1");
  });

  it("shows Unlike button when liked_by_me is true", () => {
    const onUnlike = vi.fn();
    const notes = [
      { note_id: "note_1", text: "Liked note", created_by: "user_2", created_at: "2026-04-25T00:00:00.000Z", likes: 1, liked_by_me: true, quoted: false }
    ];
    renderOrbitLayer({ ...baseProps, notes, onUnlike });

    expect(screen.getByRole("button", { name: /Unlike/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Unlike/i }));
    expect(onUnlike).toHaveBeenCalledWith("note_1");
  });

  it("does not allow liking my own orbit note", () => {
    const onLike = vi.fn();
    const notes = [
      { note_id: "note_1", text: "My note", created_by: "user_1", created_at: "2026-04-25T00:00:00.000Z", likes: 0, liked_by_me: false, quoted: false }
    ];
    renderOrbitLayer({ ...baseProps, notes, onLike });

    expect(screen.queryByRole("button", { name: /Like/i })).not.toBeInTheDocument();
    expect(document.querySelector(".orbit-note--own")).not.toBeNull();
    expect(onLike).not.toHaveBeenCalled();
  });

  it("does not render like controls when reactions are disabled", () => {
    const notes = [
      { note_id: "note_1", text: "Observer visible", created_by: "user_2", created_at: "2026-04-25T00:00:00.000Z", likes: 2, liked_by_me: false, quoted: false }
    ];
    renderOrbitLayer({ ...baseProps, notes, canReact: false });

    expect(screen.queryByRole("button", { name: /Like/i })).not.toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders quoted badge and keeps like button interactive", () => {
    const onLike = vi.fn();
    renderOrbitLayer({
      ...baseProps,
      notes: [{ note_id: "note_1", text: "Quoted note", created_by: "user_2", created_at: "2026-05-01T00:00:00.000Z", likes: 0, liked_by_me: false, quoted: true }],
      onLike
    });
    expect(screen.getByText("Quoted")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Like/i }));
    expect(onLike).toHaveBeenCalledWith("note_1");
  });

  it("renders the promote button in the header when canPromote is true", () => {
    const onPromoteClick = vi.fn();
    renderOrbitLayer({ ...baseProps, canPromote: true, hasPromotable: true, onPromoteClick });
    const button = screen.getByRole("button", { name: /Promote orbit notes/i });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onPromoteClick).toHaveBeenCalledTimes(1);
  });

  it("disables the promote button when there are no promotable notes", () => {
    const onPromoteClick = vi.fn();
    renderOrbitLayer({ ...baseProps, canPromote: true, hasPromotable: false, onPromoteClick });
    const button = screen.getByRole("button", { name: /Promote orbit notes/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onPromoteClick).not.toHaveBeenCalled();
  });

  it("hides the promote button entirely when canPromote is false", () => {
    renderOrbitLayer({ ...baseProps, canPromote: false, hasPromotable: true, onPromoteClick: vi.fn() });
    expect(screen.queryByRole("button", { name: /Promote orbit notes/i })).not.toBeInTheDocument();
  });
});
