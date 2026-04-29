import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClaudeSessionPicker } from "../src/components/ClaudeSessionPicker.js";

describe("ClaudeSessionPicker", () => {
  it("requests and shows complete preview content before selecting resume", async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    const onRequestPreview = vi.fn().mockResolvedValue(undefined);
    render(
      <ClaudeSessionPicker
        canManageRoom={true}
        agentId="agent_1"
        catalog={{
          agent_id: "agent_1",
          working_dir: "D:\\Development\\2",
          sessions: [{
            session_id: "session_1",
            title: "Planning",
            project_dir: "D:\\Development\\2",
            updated_at: "2026-04-29T00:00:00.000Z",
            message_count: 2,
            byte_size: 100,
            importable: true
          }]
        }}
        selection={undefined}
        previews={[{
          preview_id: "preview_1",
          agent_id: "agent_1",
          session_id: "session_1",
          status: "completed",
          messages: [
            { sequence: 0, author_role: "user", source_kind: "user", text: "Hello Claude" },
            { sequence: 1, author_role: "assistant", source_kind: "assistant", text: "Hi there" }
          ]
        }]}
        onRequestPreview={onRequestPreview}
        onSelect={onSelect}
      />
    );

    expect(screen.getByText(/Claude Code session/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Inspect latest: Planning/ })[0]);
    expect(screen.getByRole("dialog", { name: /Session details/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Planning" })).toBeInTheDocument();
    expect(screen.getByText(/Messages/)).toBeInTheDocument();
    await waitFor(() => expect(onRequestPreview).toHaveBeenCalledWith("session_1"));
    expect(screen.getByText(/Transcript preview/)).toBeInTheDocument();
    expect(screen.getByText(/Hello Claude/)).toBeInTheDocument();
    expect(screen.getByText(/Hi there/)).toBeInTheDocument();
    expect(screen.getByText(/upload the complete selected Claude Code session/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Select and resume/ }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ mode: "resume", sessionId: "session_1" }));
  });


  it("opens inspected history in a modal outside the scrollable session list", async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    const onRequestPreview = vi.fn().mockResolvedValue(undefined);
    const sessions = Array.from({ length: 24 }, (_, index) => ({
      session_id: `session_${index}`,
      title: `History ${index}`,
      project_dir: "D:\\Development\\2",
      updated_at: `2026-04-29T00:00:${String(index).padStart(2, "0")}.000Z`,
      message_count: index + 1,
      byte_size: 1024 * (index + 1),
      importable: true
    }));

    const { container } = render(
      <ClaudeSessionPicker
        canManageRoom={true}
        agentId="agent_1"
        catalog={{ agent_id: "agent_1", working_dir: "D:\\Development\\2", sessions }}
        selection={undefined}
        previews={[{
          preview_id: "preview_1",
          agent_id: "agent_1",
          session_id: "session_17",
          status: "completed",
          messages: [{ sequence: 0, author_role: "user", source_kind: "user", text: "Resume this long history" }]
        }]}
        onRequestPreview={onRequestPreview}
        onSelect={onSelect}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Inspect" })[17]);

    const dialog = screen.getByRole("dialog", { name: /Session details/ });
    expect(dialog.closest(".claude-session-modal-overlay")).not.toBeNull();
    expect(dialog.closest(".claude-session-list")).toBeNull();
    expect(container.querySelector(".claude-session-list")?.contains(dialog)).toBe(false);
    expect(screen.getByRole("heading", { name: "History 17" })).toBeInTheDocument();
    await waitFor(() => expect(onRequestPreview).toHaveBeenCalledWith("session_17"));
    expect(screen.getByText("Resume this long history")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Select and resume/ }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ mode: "resume", sessionId: "session_17" }));
  });

  it("does not hide the active agent picker when a different agent has a selection", () => {
    render(
      <ClaudeSessionPicker
        canManageRoom={true}
        agentId="agent_1"
        catalog={{
          agent_id: "agent_1",
          working_dir: "D:\\Development\\2",
          sessions: [{
            session_id: "session_1",
            title: "Planning",
            project_dir: "D:\\Development\\2",
            updated_at: "2026-04-29T00:00:00.000Z",
            message_count: 2,
            byte_size: 100,
            importable: true
          }]
        }}
        selection={{ agent_id: "agent_2", mode: "fresh", selected_by: "owner" }}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByText(/Claude Code session/)).toBeInTheDocument();
  });
});
