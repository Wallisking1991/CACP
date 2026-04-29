import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClaudeSessionPicker } from "../src/components/ClaudeSessionPicker.js";

describe("ClaudeSessionPicker", () => {
  it("warns before uploading a full Claude session and selects resume", async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
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
        onSelect={onSelect}
      />
    );

    expect(screen.getByText(/Claude Code session/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Resume latest: Planning/ })[0]);
    expect(screen.getByText(/upload the complete selected Claude Code session/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Confirm upload and resume/ }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ mode: "resume", sessionId: "session_1" }));
  });
});
