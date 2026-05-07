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

    expect(screen.getByText(/2/)).toBeInTheDocument();
    const likesSpan = document.querySelector(".orbit-note-likes");
    expect(likesSpan!.textContent).not.toContain("👍");
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
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });

  it("renders quoted mark inside meta row instead of absolute badge", () => {
    renderOrbitLayer({
      ...baseProps,
      notes: [{ note_id: "note_1", text: "Quoted note", created_by: "user_2", created_at: "2026-05-01T00:00:00.000Z", likes: 0, liked_by_me: false, quoted: true }],
    });
    const note = document.querySelector(".orbit-note");
    const meta = note!.querySelector(".orbit-note-meta");
    expect(meta).not.toBeNull();
    expect(meta!.textContent).toContain("Quoted");
    expect(note!.querySelector(".orbit-note-quoted-badge")).toBeNull();
  });

  it("renders like button inside meta row and removes separate actions row", () => {
    const notes = [
      { note_id: "note_1", text: "Note text", created_by: "user_2", created_at: "2026-04-25T00:00:00.000Z", likes: 2, liked_by_me: false, quoted: false }
    ];
    renderOrbitLayer({ ...baseProps, notes });

    const note = document.querySelector(".orbit-note");
    const meta = note!.querySelector(".orbit-note-meta");
    expect(meta).not.toBeNull();
    expect(meta!.querySelector('[aria-label="Like"]')).not.toBeNull();
    expect(note!.querySelector(".orbit-note-actions")).toBeNull();
  });

  it("hides like count and button when there are no likes", () => {
    const notes = [
      { note_id: "note_1", text: "No likes yet", created_by: "user_2", created_at: "2026-04-25T00:00:00.000Z", likes: 0, liked_by_me: false, quoted: false }
    ];
    renderOrbitLayer({ ...baseProps, notes });

    const meta = document.querySelector(".orbit-note-meta");
    expect(meta!.querySelector(".orbit-note-likes")).toBeNull();
    expect(meta!.querySelector(".orbit-like-btn-inline")).toBeNull();
  });

  it("reveals like button on hover when note has no likes yet", () => {
    const onLike = vi.fn();
    const notes = [
      { note_id: "note_1", text: "New note", created_by: "user_2", created_at: "2026-04-25T00:00:00.000Z", likes: 0, liked_by_me: false, quoted: false }
    ];
    renderOrbitLayer({ ...baseProps, notes, onLike });

    // Default: no button visible
    expect(screen.queryByRole("button", { name: /Like/i })).not.toBeInTheDocument();

    // Hover reveals the button
    const noteEl = document.querySelector(".orbit-note");
    fireEvent.mouseEnter(noteEl!);
    const btn = screen.getByRole("button", { name: /Like/i });
    expect(btn.textContent).toContain("👍");

    fireEvent.click(btn);
    expect(onLike).toHaveBeenCalledWith("note_1");
  });

  it("renders thumbs up icon instead of heart icon", () => {
    const notes = [
      { note_id: "note_1", text: "Note text", created_by: "user_2", created_at: "2026-04-25T00:00:00.000Z", likes: 2, liked_by_me: false, quoted: false }
    ];
    renderOrbitLayer({ ...baseProps, notes });

    const likeBtn = screen.getByRole("button", { name: /Like/i });
    expect(likeBtn.textContent).toContain("👍");
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

  it("shows reply button on hover and calls onReply when clicked", () => {
    const onReply = vi.fn();
    const notes = [
      { note_id: "note_1", text: "Hello", created_by: "user_2", created_at: "2026-04-25T00:00:00.000Z", likes: 0, liked_by_me: false, quoted: false }
    ];
    renderOrbitLayer({ ...baseProps, notes, onReply });

    // Default: no reply button visible
    expect(screen.queryByRole("button", { name: /Reply/i })).not.toBeInTheDocument();

    // Hover reveals the reply button
    const noteEl = document.querySelector(".orbit-note");
    fireEvent.mouseEnter(noteEl!);
    const btn = screen.getByRole("button", { name: /Reply/i });
    expect(btn.textContent).toContain("↩");

    fireEvent.click(btn);
    expect(onReply).toHaveBeenCalledWith("note_1");
  });

  it("renders reply preview for notes with reply_to", () => {
    const notes = [
      { note_id: "note_1", text: "Original", created_by: "user_2", created_at: "2026-04-25T00:00:00.000Z", likes: 0, liked_by_me: false, quoted: false },
      { note_id: "note_2", text: "Reply text", created_by: "user_1", created_at: "2026-04-25T00:00:01.000Z", likes: 0, liked_by_me: false, quoted: false, reply_to: "note_1" }
    ];
    renderOrbitLayer({ ...baseProps, notes });

    expect(screen.getByText("Reply text")).toBeInTheDocument();
    const replyPreview = document.querySelector(".orbit-note-reply-preview");
    expect(replyPreview).not.toBeNull();
    expect(replyPreview!.textContent).toContain("Bob");
    expect(replyPreview!.textContent).toContain("Original");
  });

  it("does not show reply button when canReact is false", () => {
    const onReply = vi.fn();
    const notes = [
      { note_id: "note_1", text: "Hello", created_by: "user_2", created_at: "2026-04-25T00:00:00.000Z", likes: 0, liked_by_me: false, quoted: false }
    ];
    renderOrbitLayer({ ...baseProps, notes, onReply, canReact: false });

    const noteEl = document.querySelector(".orbit-note");
    fireEvent.mouseEnter(noteEl!);
    expect(screen.queryByRole("button", { name: /Reply/i })).not.toBeInTheDocument();
  });

  it("highlights message that @mentions current user", () => {
    const notes = [
      { note_id: "note_1", text: "Hey @Alice check this", created_by: "user_2", created_at: "2026-04-25T00:00:00.000Z", likes: 0, liked_by_me: false, quoted: false }
    ];
    renderOrbitLayer({ ...baseProps, notes, currentDisplayName: "Alice" });

    const noteEl = document.querySelector(".orbit-note");
    expect(noteEl!.classList.contains("orbit-note--highlighted")).toBe(true);
    expect(document.querySelector(".orbit-note-mention-icon")).not.toBeNull();
  });

  it("highlights message that replies to current user's note", () => {
    const notes = [
      { note_id: "note_1", text: "My message", created_by: "user_1", created_at: "2026-04-25T00:00:00.000Z", likes: 0, liked_by_me: false, quoted: false },
      { note_id: "note_2", text: "Reply to you", created_by: "user_2", created_at: "2026-04-25T00:00:01.000Z", likes: 0, liked_by_me: false, quoted: false, reply_to: "note_1" }
    ];
    renderOrbitLayer({ ...baseProps, notes });

    const notesEls = document.querySelectorAll(".orbit-note");
    expect(notesEls[0]!.classList.contains("orbit-note--highlighted")).toBe(false);
    expect(notesEls[1]!.classList.contains("orbit-note--highlighted")).toBe(true);
    expect(document.querySelector(".orbit-note-reply-icon")).not.toBeNull();
  });

  it("shows mention icon instead of reply icon when both apply", () => {
    const notes = [
      { note_id: "note_1", text: "My message", created_by: "user_1", created_at: "2026-04-25T00:00:00.000Z", likes: 0, liked_by_me: false, quoted: false },
      { note_id: "note_2", text: "@Alice replying", created_by: "user_2", created_at: "2026-04-25T00:00:01.000Z", likes: 0, liked_by_me: false, quoted: false, reply_to: "note_1" }
    ];
    renderOrbitLayer({ ...baseProps, notes, currentDisplayName: "Alice" });

    expect(document.querySelector(".orbit-note-mention-icon")).not.toBeNull();
    expect(document.querySelector(".orbit-note-reply-icon")).toBeNull();
  });
});
