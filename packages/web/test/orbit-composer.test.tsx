import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import OrbitComposer from "../src/components/OrbitComposer.js";
import { LangProvider } from "../src/i18n/LangProvider.js";

function renderOrbitComposer(
  props: React.ComponentProps<typeof OrbitComposer>
) {
  return render(
    <LangProvider>
      <OrbitComposer {...props} />
    </LangProvider>
  );
}

describe("OrbitComposer", () => {
  const noop = () => {};
  const baseProps = {
    role: "member" as const,
    members: [
      { id: "p1", display_name: "Alice", role: "owner" },
      { id: "p2", display_name: "Bob", role: "member" },
    ],
    onSendOrbitNote: vi.fn(),
    onTypingInput: noop,
    onStopTyping: noop,
  };

  it("renders textarea with orbit placeholder", () => {
    renderOrbitComposer(baseProps);
    expect(
      screen.getByPlaceholderText(/Discussion space/i)
    ).toBeInTheDocument();
  });

  it("calls onSendOrbitNote on Enter", () => {
    const onSendOrbitNote = vi.fn();
    renderOrbitComposer({ ...baseProps, onSendOrbitNote });
    const textarea = screen.getByPlaceholderText(/Discussion space/i);
    fireEvent.change(textarea, { target: { value: "Hey team" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSendOrbitNote).toHaveBeenCalledWith("Hey team", [], undefined);
  });

  it("does not send on Shift+Enter", () => {
    const onSendOrbitNote = vi.fn();
    renderOrbitComposer({ ...baseProps, onSendOrbitNote });
    const textarea = screen.getByPlaceholderText(/Discussion space/i);
    fireEvent.change(textarea, { target: { value: "Hey team" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSendOrbitNote).not.toHaveBeenCalled();
  });

  it("shows Send button", () => {
    renderOrbitComposer(baseProps);
    expect(screen.getByRole("button", { name: /Send/i })).toBeInTheDocument();
  });

  it("shows mention dropdown when @ is typed", () => {
    renderOrbitComposer(baseProps);
    const textarea = screen.getByPlaceholderText(
      /Discussion space/i
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "@", selectionStart: 1 } });
    expect(document.querySelector(".mention-dropdown")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("filters mention dropdown by query", () => {
    renderOrbitComposer(baseProps);
    const textarea = screen.getByPlaceholderText(
      /Discussion space/i
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "@Al", selectionStart: 3 } });
    expect(document.querySelector(".mention-dropdown")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  });

  it("shows reply bar when replyTo is provided", () => {
    renderOrbitComposer({
      ...baseProps,
      replyTo: { noteId: "n1", authorName: "Bob", text: "Original message" },
      onCancelReply: vi.fn(),
    });
    expect(screen.getByText("Original message")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Cancel reply/i })
    ).toBeInTheDocument();
  });

  it("calls onSendOrbitNote with replyTo noteId when sending a reply", () => {
    const onSendOrbitNote = vi.fn();
    renderOrbitComposer({
      ...baseProps,
      onSendOrbitNote,
      replyTo: { noteId: "n1", authorName: "Bob", text: "Original message" },
      onCancelReply: vi.fn(),
    });
    const textarea = screen.getByPlaceholderText(/Discussion space/i);
    fireEvent.change(textarea, { target: { value: "Reply text" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(onSendOrbitNote).toHaveBeenCalledWith("Reply text", [], "n1");
  });

  it("calls onCancelReply when cancel button clicked", () => {
    const onCancelReply = vi.fn();
    renderOrbitComposer({
      ...baseProps,
      replyTo: { noteId: "n1", authorName: "Bob", text: "Original message" },
      onCancelReply,
    });
    fireEvent.click(screen.getByRole("button", { name: /Cancel reply/i }));
    expect(onCancelReply).toHaveBeenCalledTimes(1);
  });

  it("focuses textarea when replyTo is provided", () => {
    const { rerender } = renderOrbitComposer(baseProps);
    const textarea = screen.getByPlaceholderText(
      /Discussion space/i
    ) as HTMLTextAreaElement;
    textarea.blur();
    expect(document.activeElement).not.toBe(textarea);

    rerender(
      <LangProvider>
        <OrbitComposer
          {...baseProps}
          replyTo={{ noteId: "n1", authorName: "Bob", text: "Original" }}
          onCancelReply={vi.fn()}
        />
      </LangProvider>
    );
    expect(document.activeElement).toBe(textarea);
  });

  it("uploads and sends an attachment-only Orbit note", async () => {
    const uploaded = {
      attachment_id: "att_1",
      name: "pixel.png",
      media_type: "image/png",
      size_bytes: 68,
      sha256: "a".repeat(64),
      kind: "image" as const,
      disposition: "inline" as const,
    };
    const onUploadAttachment = vi.fn().mockResolvedValue(uploaded);
    const onSendOrbitNote = vi.fn().mockResolvedValue(undefined);
    renderOrbitComposer({
      ...baseProps,
      onUploadAttachment,
      onSendOrbitNote,
    });
    const file = new File(["image"], "pixel.png", { type: "image/png" });

    fireEvent.change(screen.getByTestId("orbit-composer-attachment-input"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));

    await vi.waitFor(() =>
      expect(onSendOrbitNote).toHaveBeenCalledWith("", [uploaded], undefined)
    );
    expect(onUploadAttachment).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("keeps an attachment draft when upload fails so it can be retried", async () => {
    const onUploadAttachment = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        attachment_id: "att_retry",
        name: "notes.txt",
        media_type: "text/plain",
        size_bytes: 5,
        sha256: "b".repeat(64),
        kind: "text",
        disposition: "inline",
      });
    renderOrbitComposer({ ...baseProps, onUploadAttachment });
    fireEvent.change(screen.getByTestId("orbit-composer-attachment-input"), {
      target: {
        files: [new File(["hello"], "notes.txt", { type: "text/plain" })],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));
    await screen.findByRole("alert");
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry notes.txt/i }));
    await vi.waitFor(() => expect(onUploadAttachment).toHaveBeenCalledTimes(2));
  });
});
