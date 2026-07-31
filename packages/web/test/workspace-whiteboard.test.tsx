import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CacpEvent } from "@cacp/protocol";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import Workspace from "../src/components/Workspace.js";
import { LangProvider } from "../src/i18n/LangProvider.js";

function event(
  type: CacpEvent["type"],
  payload: Record<string, unknown>,
  sequence: number,
  actorId = "user_1"
): CacpEvent {
  return {
    protocol: "cacp",
    version: "0.3.0",
    event_id: `evt_${sequence}`,
    room_id: "room_1",
    type,
    actor_id: actorId,
    created_at: `2026-07-31T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload,
  };
}

const workspaceProps = {
  session: {
    room_id: "room_1",
    token: "owner_secret",
    participant_id: "user_1",
    role: "owner" as const,
  },
  events: [
    event("room.created", { name: "Design Room" }, 1),
    event(
      "participant.joined",
      {
        participant: {
          id: "user_1",
          display_name: "Wei",
          role: "owner",
          type: "human",
        },
      },
      2
    ),
    event(
      "agent.registered",
      {
        agent_id: "agent_1",
        name: "Codex",
        capabilities: ["repo.read"],
      },
      3,
      "agent_1"
    ),
    event("room.agent_selected", { agent_id: "agent_1" }, 4),
  ],
  onLeaveRoom: vi.fn(),
  onSendMessage: vi.fn(),
  onSelectAgent: vi.fn(),
  onCreateInvite: vi.fn(async () => undefined),
  onApproveJoinRequest: vi.fn(),
  onRejectJoinRequest: vi.fn(),
  onRemoveParticipant: vi.fn(),
  loadWhiteboardSession: vi.fn(async () => () => ({
    subscribeStatus: () => () => {},
    setRole: () => {},
    destroy: () => {},
  })),
};

describe("Collaborative Whiteboard workspace", () => {
  it("starts a room-scoped session only after the editor mounts", async () => {
    const editor = {
      getScene: () => ({ elements: [], appState: {}, files: {} }),
      updateScene: vi.fn(),
      subscribeSceneChanges: () => () => {},
      setDisplayOptions: () => {},
      setReadOnly: vi.fn(),
      exportScene: async () => new Blob(),
      destroy: vi.fn(),
    };
    const mount = vi.fn(() => editor);
    const loadWhiteboardEditorAdapter = vi.fn(async () => ({ mount }));
    const sessionController = {
      subscribeStatus: vi.fn(() => () => {}),
      setRole: vi.fn(),
      destroy: vi.fn(),
    };
    const createSession = vi.fn(() => sessionController);
    const loadWhiteboardSession = vi.fn(async () => createSession);

    render(
      <LangProvider>
        <Workspace
          {...workspaceProps}
          loadWhiteboardEditorAdapter={loadWhiteboardEditorAdapter}
          loadWhiteboardSession={loadWhiteboardSession}
        />
      </LangProvider>
    );

    expect(loadWhiteboardSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: /whiteboard/i }));

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: {
          roomId: "room_1",
          participantId: "user_1",
          token: "owner_secret",
          role: "owner",
        },
        editor,
      })
    );
    expect(mount).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ readOnly: true })
    );
  });

  it("loads the editor on first entry and restores the conversation workspace", async () => {
    const loadWhiteboardEditorAdapter = vi.fn(async () => ({
      mount(container: HTMLElement) {
        const editor = document.createElement("div");
        editor.textContent = "In-memory whiteboard editor";
        container.append(editor);

        return {
          getScene: () => ({ elements: [], appState: {}, files: {} }),
          updateScene: () => {},
          subscribeSceneChanges: () => () => {},
          setDisplayOptions: () => {},
          setReadOnly: () => {},
          exportScene: async () => new Blob(),
          destroy: () => editor.remove(),
        };
      },
    }));

    const eventsWithQueue = [
      ...workspaceProps.events,
      event(
        "main_input.accepted",
        {
          input_id: "input_1",
          content: { text: "First queued idea", attachments: [] },
        },
        5
      ),
      event(
        "main_input.queued",
        { input_id: "input_1", queued_after_turn_id: "turn_1" },
        6,
        "system"
      ),
      event(
        "main_input.accepted",
        {
          input_id: "input_2",
          content: { text: "Second queued idea", attachments: [] },
        },
        7
      ),
      event(
        "main_input.queued",
        { input_id: "input_2", queued_after_turn_id: "turn_1" },
        8,
        "system"
      ),
    ];

    render(
      <LangProvider>
        <Workspace
          {...workspaceProps}
          events={eventsWithQueue}
          loadWhiteboardEditorAdapter={loadWhiteboardEditorAdapter}
        />
      </LangProvider>
    );

    expect(loadWhiteboardEditorAdapter).not.toHaveBeenCalled();
    expect(
      document.getElementById("whiteboard-workspace-panel")
    ).toBeInTheDocument();

    const composer = screen.getByRole("textbox", {
      name: /type a message for the agent/i,
    });
    fireEvent.change(composer, { target: { value: "Keep this draft" } });

    const thread = document.querySelector(".thread") as HTMLElement;
    thread.scrollTop = 120;

    fireEvent.click(screen.getByRole("button", { name: /toggle discussion/i }));
    expect(document.querySelector(".orbit-panel")).not.toBeNull();
    const orbitComposer = screen.getByRole("textbox", {
      name: /discussion space/i,
    });
    fireEvent.change(orbitComposer, {
      target: { value: "Keep this Orbit draft" },
    });

    const queueSummary = screen.getByRole("button", {
      name: /2 messages waiting/i,
    });
    fireEvent.click(queueSummary);
    expect(queueSummary).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("tab", { name: /whiteboard/i }));

    expect(screen.getByText("Design Room")).toBeInTheDocument();
    expect(screen.getByTestId("main-composer")).not.toBeVisible();
    expect(document.querySelector(".orbit-panel")).not.toBeVisible();
    expect(
      screen.queryByRole("button", { name: /toggle discussion/i })
    ).not.toBeInTheDocument();
    expect(
      await screen.findByText("In-memory whiteboard editor")
    ).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: /main conversation/i }));

    await waitFor(() =>
      expect(screen.getByTestId("main-composer")).toBeVisible()
    );
    expect(composer).toHaveValue("Keep this draft");
    expect(thread.scrollTop).toBe(120);
    expect(document.querySelector(".orbit-panel")).not.toBeNull();
    expect(orbitComposer).toHaveValue("Keep this Orbit draft");
    expect(queueSummary).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("First queued idea")).toBeVisible();
    expect(screen.getByText("Second queued idea")).toBeVisible();
    expect(
      screen.getByRole("tab", { name: /main conversation/i })
    ).toHaveFocus();
    expect(loadWhiteboardEditorAdapter).toHaveBeenCalledTimes(1);
  });

  it("supports keyboard navigation between workspace tabs", async () => {
    const loadWhiteboardEditorAdapter = vi.fn(async () => ({
      mount() {
        return {
          getScene: () => ({ elements: [], appState: {}, files: {} }),
          updateScene: () => {},
          subscribeSceneChanges: () => () => {},
          setDisplayOptions: () => {},
          setReadOnly: () => {},
          exportScene: async () => new Blob(),
          destroy: () => {},
        };
      },
    }));

    render(
      <LangProvider>
        <Workspace
          {...workspaceProps}
          loadWhiteboardEditorAdapter={loadWhiteboardEditorAdapter}
        />
      </LangProvider>
    );

    const conversationTab = screen.getByRole("tab", {
      name: /main conversation/i,
    });
    conversationTab.focus();
    fireEvent.keyDown(conversationTab, { key: "ArrowRight" });

    const whiteboardTab = screen.getByRole("tab", { name: /whiteboard/i });
    expect(whiteboardTab).toHaveAttribute("aria-selected", "true");
    expect(whiteboardTab).toHaveFocus();
    await waitFor(() =>
      expect(
        document.querySelector(".whiteboard-surface__editor")
      ).toHaveAttribute("aria-hidden", "false")
    );

    fireEvent.keyDown(whiteboardTab, { key: "ArrowLeft" });
    expect(conversationTab).toHaveAttribute("aria-selected", "true");
    expect(conversationTab).toHaveFocus();
  });

  it("updates read-only mode without remounting the current board", async () => {
    const setReadOnly = vi.fn();
    const destroy = vi.fn();
    const mount = vi.fn(() => ({
      getScene: () => ({ elements: [], appState: {}, files: {} }),
      updateScene: () => {},
      subscribeSceneChanges: () => () => {},
      setDisplayOptions: () => {},
      setReadOnly,
      exportScene: async () => new Blob(),
      destroy,
    }));
    const loadWhiteboardEditorAdapter = vi.fn(async () => ({ mount }));
    const view = render(
      <LangProvider>
        <Workspace
          {...workspaceProps}
          loadWhiteboardEditorAdapter={loadWhiteboardEditorAdapter}
        />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole("tab", { name: /whiteboard/i }));
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));

    view.rerender(
      <LangProvider>
        <Workspace
          {...workspaceProps}
          session={{ ...workspaceProps.session, role: "observer" }}
          loadWhiteboardEditorAdapter={loadWhiteboardEditorAdapter}
        />
      </LangProvider>
    );

    await waitFor(() => expect(setReadOnly).toHaveBeenCalledWith(true));
    expect(mount).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
  });

  it("returns to a lazy conversation workspace when the room changes", async () => {
    const destroy = vi.fn();
    const mount = vi.fn(() => ({
      getScene: () => ({ elements: [], appState: {}, files: {} }),
      updateScene: () => {},
      subscribeSceneChanges: () => () => {},
      setDisplayOptions: () => {},
      setReadOnly: () => {},
      exportScene: async () => new Blob(),
      destroy,
    }));
    const loadWhiteboardEditorAdapter = vi.fn(async () => ({ mount }));
    const view = render(
      <LangProvider>
        <Workspace
          {...workspaceProps}
          loadWhiteboardEditorAdapter={loadWhiteboardEditorAdapter}
        />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole("tab", { name: /whiteboard/i }));
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));

    view.rerender(
      <LangProvider>
        <Workspace
          {...workspaceProps}
          session={{ ...workspaceProps.session, room_id: "room_2" }}
          events={workspaceProps.events.map((item) => ({
            ...item,
            room_id: "room_2",
          }))}
          loadWhiteboardEditorAdapter={loadWhiteboardEditorAdapter}
        />
      </LangProvider>
    );

    expect(
      screen.getByRole("tab", { name: /main conversation/i })
    ).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(destroy).toHaveBeenCalledTimes(1));
    expect(mount).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: /whiteboard/i }));
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(2));
  });

  it("lets the participant retry a transient editor load failure", async () => {
    const loadWhiteboardEditorAdapter = vi
      .fn()
      .mockRejectedValueOnce(new Error("stale deployment chunk"))
      .mockResolvedValue({
        mount(container: HTMLElement) {
          const editor = document.createElement("div");
          editor.textContent = "Recovered whiteboard editor";
          container.append(editor);
          return {
            getScene: () => ({ elements: [], appState: {}, files: {} }),
            updateScene: () => {},
            subscribeSceneChanges: () => () => {},
            setDisplayOptions: () => {},
            setReadOnly: () => {},
            exportScene: async () => new Blob(),
            destroy: () => editor.remove(),
          };
        },
      });

    render(
      <LangProvider>
        <Workspace
          {...workspaceProps}
          loadWhiteboardEditorAdapter={loadWhiteboardEditorAdapter}
        />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole("tab", { name: /whiteboard/i }));
    expect(
      await screen.findByText(/whiteboard could not be loaded/i)
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(
      await screen.findByText("Recovered whiteboard editor")
    ).toBeVisible();
    expect(loadWhiteboardEditorAdapter).toHaveBeenCalledTimes(2);
  });

  it("does not expose a whiteboard workspace to agent sessions", () => {
    const loadWhiteboardEditorAdapter = vi.fn();

    render(
      <LangProvider>
        <Workspace
          {...workspaceProps}
          session={{ ...workspaceProps.session, role: "agent" }}
          loadWhiteboardEditorAdapter={loadWhiteboardEditorAdapter}
        />
      </LangProvider>
    );

    expect(
      screen.queryByRole("tab", { name: /whiteboard/i })
    ).not.toBeInTheDocument();
    expect(
      document.getElementById("whiteboard-workspace-panel")
    ).not.toBeInTheDocument();
    expect(
      document.getElementById("conversation-workspace-panel")
    ).not.toHaveAttribute("role");
    expect(
      document.getElementById("conversation-workspace-panel")
    ).not.toHaveAttribute("aria-labelledby");
    expect(loadWhiteboardEditorAdapter).not.toHaveBeenCalled();
  });
});
