import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import MainComposer from "../src/components/MainComposer.js";
import { LangProvider } from "../src/i18n/LangProvider.js";

function renderMainComposer(props: React.ComponentProps<typeof MainComposer>) {
  return render(
    <LangProvider>
      <MainComposer {...props} />
    </LangProvider>
  );
}

describe("MainComposer", () => {
  const noop = () => {};
  const baseProps = {
    role: "owner" as const,
    turnInFlight: false,
    agents: [{ agent_id: "a1", name: "Claude Code" }],
    onSendMainInput: vi.fn(),
    onTypingInput: noop,
    onStopTyping: noop,
  };

  it("renders textarea with Agent placeholder", () => {
    renderMainComposer(baseProps);
    expect(
      screen.getByPlaceholderText(/Type a message for the Agent/i)
    ).toBeInTheDocument();
  });

  it("calls onSendMainInput on Enter", async () => {
    const onSendMainInput = vi.fn();
    renderMainComposer({ ...baseProps, onSendMainInput });
    const textarea = screen.getByPlaceholderText(
      /Type a message for the Agent/i
    );
    fireEvent.change(textarea, { target: { value: "Hello Agent" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    await waitFor(() =>
      expect(onSendMainInput).toHaveBeenCalledWith("Hello Agent", [])
    );
  });

  it("does not send on Shift+Enter", () => {
    const onSendMainInput = vi.fn();
    renderMainComposer({ ...baseProps, onSendMainInput });
    const textarea = screen.getByPlaceholderText(
      /Type a message for the Agent/i
    );
    fireEvent.change(textarea, { target: { value: "Hello Agent" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSendMainInput).not.toHaveBeenCalled();
  });

  it("shows Trigger Agent button", () => {
    renderMainComposer(baseProps);
    expect(
      screen.getByRole("button", { name: /Trigger Agent/i })
    ).toBeInTheDocument();
  });

  it("calls onSendMainInput when button is clicked", async () => {
    const onSendMainInput = vi.fn();
    renderMainComposer({ ...baseProps, onSendMainInput });
    const textarea = screen.getByPlaceholderText(
      /Type a message for the Agent/i
    );
    fireEvent.change(textarea, { target: { value: "Click test" } });
    fireEvent.click(screen.getByRole("button", { name: /Trigger Agent/i }));
    await waitFor(() =>
      expect(onSendMainInput).toHaveBeenCalledWith("Click test", [])
    );
  });

  it("disables textarea and button when agentReady is false", () => {
    renderMainComposer({ ...baseProps, agentReady: false });
    const textarea = screen.getByPlaceholderText(
      /Type a message for the Agent/i
    );
    expect(textarea).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Trigger Agent/i })
    ).toBeDisabled();
  });

  it("keeps textarea and button enabled when agentReady is true", () => {
    renderMainComposer({ ...baseProps, agentReady: true });
    const textarea = screen.getByPlaceholderText(
      /Type a message for the Agent/i
    );
    fireEvent.change(textarea, { target: { value: "Hello" } });
    expect(textarea).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Trigger Agent/i })
    ).not.toBeDisabled();
  });

  it("uploads selected files before sending their attachment references", async () => {
    const uploaded = {
      attachment_id: "att_1",
      name: "notes.txt",
      media_type: "text/plain",
      size_bytes: 5,
      sha256: "0".repeat(64),
      kind: "text" as const,
      disposition: "inline" as const,
    };
    const onUploadAttachment = vi.fn(async () => uploaded);
    const onSendMainInput = vi.fn(async () => undefined);
    renderMainComposer({
      ...baseProps,
      onUploadAttachment,
      onSendMainInput,
      attachmentCapabilities: {
        image: "native",
        pdf: "file_path",
        text: "file_path",
        office: "file_path",
        file: "file_path",
        max_attachments: 5,
      },
    });
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByTestId("main-composer-attachment-input"), {
      target: { files: [file] },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/Type a message for the Agent/i),
      { target: { value: "Read this" } }
    );
    fireEvent.click(screen.getByRole("button", { name: /Trigger Agent/i }));

    await waitFor(() => expect(onUploadAttachment).toHaveBeenCalledWith(file));
    await waitFor(() =>
      expect(onSendMainInput).toHaveBeenCalledWith("Read this", [uploaded])
    );
  });

  it("keeps text and files selected when upload fails", async () => {
    const onUploadAttachment = vi.fn(async () => {
      throw new Error("network unavailable");
    });
    renderMainComposer({
      ...baseProps,
      onUploadAttachment,
      onSendMainInput: vi.fn(),
    });
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByTestId("main-composer-attachment-input"), {
      target: { files: [file] },
    });
    const textarea = screen.getByPlaceholderText(
      /Type a message for the Agent/i
    );
    fireEvent.change(textarea, { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: /Trigger Agent/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /message and selected files were kept/i
    );
    expect(textarea).toHaveValue("Keep this draft");
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
  });
});
