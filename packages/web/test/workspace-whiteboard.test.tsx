import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { CacpEvent } from "@cacp/protocol";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import Workspace from "../src/components/Workspace.js";
import { LangProvider } from "../src/i18n/LangProvider.js";
import type { WhiteboardSessionStatus } from "../src/whiteboard/whiteboard-session.js";
import type { WhiteboardCollaborator } from "../src/whiteboard/whiteboard-editor-adapter.js";

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
    subscribeCollaborators: () => () => {},
    subscribeActivity: () => () => {},
    focusCollaborator: () => {},
    loadSharedScene: () => {},
    setRole: () => {},
    setPresenceEnabled: () => {},
    destroy: () => {},
  })),
};

describe("Collaborative Whiteboard workspace", () => {
  it("observes board activity before lazily mounting an active editor", async () => {
    let emitActiveStatus:
      ((status: WhiteboardSessionStatus) => void) | undefined;
    let emitObservedActivity:
      | ((activity: {
          kind: "scene" | "presence";
          participantId: string;
        }) => void)
      | undefined;
    const editor = {
      getScene: () => ({ elements: [], appState: {}, files: {} }),
      updateScene: vi.fn(),
      subscribeSceneChanges: () => () => {},
      subscribePresenceChanges: () => () => {},
      setCollaborators: () => {},
      focusViewport: () => {},
      setDisplayOptions: () => {},
      setReadOnly: vi.fn(),
      exportScene: async () => new Blob(),
      destroy: vi.fn(),
    };
    const mount = vi.fn(() => editor);
    const loadWhiteboardEditorAdapter = vi.fn(async () => ({ mount }));
    const observerController = {
      subscribeStatus: vi.fn(() => () => {}),
      subscribeCollaborators: vi.fn(() => () => {}),
      subscribeActivity: vi.fn(
        (
          listener: (activity: {
            kind: "scene" | "presence";
            participantId: string;
          }) => void
        ) => {
          emitObservedActivity = listener;
          return () => {};
        }
      ),
      focusCollaborator: vi.fn(),
      loadSharedScene: vi.fn(),
      setRole: vi.fn(),
      setPresenceEnabled: vi.fn(),
      destroy: vi.fn(),
    };
    const activeController = {
      ...observerController,
      subscribeStatus: vi.fn(
        (listener: (status: WhiteboardSessionStatus) => void) => {
          emitActiveStatus = listener;
          return () => {};
        }
      ),
      subscribeActivity: vi.fn(() => () => {}),
      destroy: vi.fn(),
    };
    const createSession = vi.fn((options: { observeOnly?: boolean }) =>
      options.observeOnly ? observerController : activeController
    );
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

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(loadWhiteboardEditorAdapter).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        observeOnly: true,
        presenceEnabled: false,
      })
    );
    fireEvent.click(screen.getByRole("tab", { name: /whiteboard/i }));

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(2));
    expect(observerController.destroy).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        identity: {
          roomId: "room_1",
          participantId: "user_1",
          token: "owner_secret",
          role: "owner",
        },
        editor,
        presenceEnabled: true,
      })
    );
    expect(mount).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ readOnly: true })
    );
    fireEvent.click(screen.getByRole("tab", { name: /main conversation/i }));
    act(() =>
      emitObservedActivity?.({ kind: "scene", participantId: "user_2" })
    );
    expect(
      screen.getByLabelText(/unseen whiteboard activity/i)
    ).toBeInTheDocument();
    act(() => emitActiveStatus?.("connected"));
    await waitFor(() =>
      expect(observerController.destroy).toHaveBeenCalledTimes(1)
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
          subscribePresenceChanges: () => () => {},
          setCollaborators: () => {},
          focusViewport: () => {},
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
          subscribePresenceChanges: () => () => {},
          setCollaborators: () => {},
          focusViewport: () => {},
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
      subscribePresenceChanges: () => () => {},
      setCollaborators: () => {},
      focusViewport: () => {},
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
      subscribePresenceChanges: () => () => {},
      setCollaborators: () => {},
      focusViewport: () => {},
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
    const observerDestroy = vi.fn();
    let emitObservedCollaborators:
      ((collaborators: WhiteboardCollaborator[]) => void) | undefined;
    const loadWhiteboardSession = vi.fn(
      async () => (options: { observeOnly?: boolean }) => ({
        subscribeStatus(listener: (status: WhiteboardSessionStatus) => void) {
          if (!options.observeOnly) listener("connected");
          return () => {};
        },
        subscribeCollaborators(
          listener: (collaborators: WhiteboardCollaborator[]) => void
        ) {
          if (options.observeOnly) {
            emitObservedCollaborators = listener;
          }
          listener([]);
          return () => {};
        },
        subscribeActivity: () => () => {},
        focusCollaborator: () => {},
        loadSharedScene: () => {},
        setRole: () => {},
        setPresenceEnabled: () => {},
        destroy: options.observeOnly ? observerDestroy : () => {},
      })
    );
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
            subscribePresenceChanges: () => () => {},
            setCollaborators: () => {},
            focusViewport: () => {},
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
          loadWhiteboardSession={loadWhiteboardSession}
        />
      </LangProvider>
    );

    await waitFor(() => expect(emitObservedCollaborators).toBeDefined());
    act(() => {
      emitObservedCollaborators?.([
        {
          participantId: "user_1",
          displayName: "Owner",
          color: { background: "#fee2e2", stroke: "#dc2626" },
          canEdit: true,
        },
      ]);
    });
    expect(screen.getByLabelText(/1 active editor/i)).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("tab", { name: /whiteboard/i }));
    expect(
      await screen.findByText(/whiteboard could not be loaded/i)
    ).toBeVisible();
    expect(screen.getByLabelText(/1 active editor/i)).toHaveTextContent("1");
    expect(observerDestroy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(
      await screen.findByText("Recovered whiteboard editor")
    ).toBeVisible();
    expect(loadWhiteboardEditorAdapter).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(observerDestroy).toHaveBeenCalledTimes(1));
  });

  it("keeps the editor visible with a clear warning after sync rejection", async () => {
    let emitStatus: ((status: WhiteboardSessionStatus) => void) | undefined;
    const loadWhiteboardEditorAdapter = vi.fn(async () => ({
      mount(container: HTMLElement) {
        const editorElement = document.createElement("div");
        editorElement.textContent = "Preserved local board";
        container.append(editorElement);
        return {
          getScene: () => ({ elements: [], appState: {}, files: {} }),
          updateScene: () => {},
          subscribeSceneChanges: () => () => {},
          subscribePresenceChanges: () => () => {},
          setCollaborators: () => {},
          focusViewport: () => {},
          setDisplayOptions: () => {},
          setReadOnly: () => {},
          exportScene: async () => new Blob(),
          destroy: () => editorElement.remove(),
        };
      },
    }));
    const loadSharedScene = vi.fn();
    const loadWhiteboardSession = vi.fn(async () => () => ({
      subscribeStatus(listener: (status: WhiteboardSessionStatus) => void) {
        emitStatus = listener;
        listener("connected");
        return () => {};
      },
      subscribeCollaborators: () => () => {},
      subscribeActivity: () => () => {},
      focusCollaborator: () => {},
      loadSharedScene,
      setRole: () => {},
      setPresenceEnabled: () => {},
      destroy: () => {},
    }));

    render(
      <LangProvider>
        <Workspace
          {...workspaceProps}
          loadWhiteboardEditorAdapter={loadWhiteboardEditorAdapter}
          loadWhiteboardSession={loadWhiteboardSession}
        />
      </LangProvider>
    );
    fireEvent.click(screen.getByRole("tab", { name: /whiteboard/i }));
    expect(await screen.findByText("Preserved local board")).toBeVisible();

    act(() => emitStatus?.("rejected"));

    expect(screen.getByText(/latest changes are not shared/i)).toBeVisible();
    expect(
      document.querySelector(".whiteboard-surface__status--warning")
    ).toBeVisible();
    expect(screen.getByText("Preserved local board")).toBeVisible();

    act(() => emitStatus?.("conflicted"));
    fireEvent.click(screen.getByRole("button", { name: /load shared board/i }));
    expect(loadSharedScene).toHaveBeenCalledTimes(1);
  });

  it("shows collaborators, follows their viewport, and clears quiet activity in both directions", async () => {
    let emitObservedCollaborators:
      ((collaborators: WhiteboardCollaborator[]) => void) | undefined;
    let emitObservedActivity:
      | ((activity: {
          kind: "scene" | "presence";
          participantId: string;
        }) => void)
      | undefined;
    let emitSurfaceCollaborators:
      ((collaborators: WhiteboardCollaborator[]) => void) | undefined;
    let emitSurfaceActivity:
      | ((activity: {
          kind: "scene" | "presence";
          participantId: string;
        }) => void)
      | undefined;
    const focusCollaborator = vi.fn();
    const setSurfacePresenceEnabled = vi.fn();
    const loadWhiteboardSession = vi.fn(
      async () => (options: { presenceEnabled?: boolean }) => {
        const passive = options.presenceEnabled === false;
        return {
          subscribeStatus(listener: (status: WhiteboardSessionStatus) => void) {
            listener("connected");
            return () => {};
          },
          subscribeCollaborators(
            listener: (collaborators: WhiteboardCollaborator[]) => void
          ) {
            if (passive) emitObservedCollaborators = listener;
            else emitSurfaceCollaborators = listener;
            listener([]);
            return () => {};
          },
          subscribeActivity(
            listener: (activity: {
              kind: "scene" | "presence";
              participantId: string;
            }) => void
          ) {
            if (passive) emitObservedActivity = listener;
            else emitSurfaceActivity = listener;
            return () => {};
          },
          focusCollaborator,
          loadSharedScene: () => {},
          setRole: () => {},
          setPresenceEnabled: passive ? () => {} : setSurfacePresenceEnabled,
          destroy: () => {},
        };
      }
    );
    const loadWhiteboardEditorAdapter = vi.fn(async () => ({
      mount(container: HTMLElement) {
        const editor = document.createElement("div");
        editor.textContent = "Presence-aware board";
        container.append(editor);
        return {
          getScene: () => ({ elements: [], appState: {}, files: {} }),
          updateScene: () => {},
          subscribeSceneChanges: () => () => {},
          subscribePresenceChanges: () => () => {},
          setCollaborators: () => {},
          focusViewport: () => {},
          setDisplayOptions: () => {},
          setReadOnly: () => {},
          exportScene: async () => new Blob(),
          destroy: () => editor.remove(),
        };
      },
    }));
    const view = render(
      <LangProvider>
        <Workspace
          {...workspaceProps}
          loadWhiteboardEditorAdapter={loadWhiteboardEditorAdapter}
          loadWhiteboardSession={loadWhiteboardSession}
        />
      </LangProvider>
    );
    await waitFor(() => expect(loadWhiteboardSession).toHaveBeenCalledTimes(1));
    act(() =>
      emitObservedCollaborators?.([
        {
          participantId: "user_2",
          displayName: "Alice",
          color: { background: "#dbeafe", stroke: "#2563eb" },
          canEdit: true,
          viewport: { scrollX: -20, scrollY: 10, zoom: 1.25 },
        },
      ])
    );
    expect(screen.getByLabelText(/1 active editor/i)).toBeInTheDocument();
    act(() =>
      emitObservedActivity?.({ kind: "scene", participantId: "user_2" })
    );
    expect(
      screen.getByLabelText(/unseen whiteboard activity/i)
    ).toBeInTheDocument();
    expect(loadWhiteboardEditorAdapter).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: /whiteboard/i }));
    expect(await screen.findByText("Presence-aware board")).toBeVisible();
    expect(
      screen.queryByLabelText(/unseen whiteboard activity/i)
    ).not.toBeInTheDocument();

    act(() =>
      emitSurfaceCollaborators?.([
        {
          participantId: "user_1",
          displayName: "Wei",
          color: { background: "#dcfce7", stroke: "#16a34a" },
          canEdit: true,
        },
        {
          participantId: "user_2",
          displayName: "Alice",
          color: { background: "#dbeafe", stroke: "#2563eb" },
          canEdit: true,
          viewport: { scrollX: -20, scrollY: 10, zoom: 1.25 },
        },
        {
          participantId: "viewer_1",
          displayName: "Observer",
          color: { background: "#fef3c7", stroke: "#d97706" },
          canEdit: false,
        },
      ])
    );
    expect(screen.getByLabelText(/2 active editors/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /view alice.+area/i }));
    expect(focusCollaborator).toHaveBeenCalledWith("user_2");

    act(() =>
      emitSurfaceActivity?.({ kind: "presence", participantId: "user_2" })
    );
    expect(
      screen.queryByLabelText(/unseen whiteboard activity/i)
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /main conversation/i }));
    expect(setSurfacePresenceEnabled).toHaveBeenLastCalledWith(false);
    act(() =>
      emitSurfaceActivity?.({ kind: "scene", participantId: "user_2" })
    );
    expect(
      screen.getByLabelText(/unseen whiteboard activity/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /whiteboard/i }));
    expect(setSurfacePresenceEnabled).toHaveBeenLastCalledWith(true);
    expect(
      screen.queryByLabelText(/unseen whiteboard activity/i)
    ).not.toBeInTheDocument();

    view.rerender(
      <LangProvider>
        <Workspace
          {...workspaceProps}
          events={[
            ...workspaceProps.events,
            event(
              "message.created",
              {
                message_id: "message_1",
                content: { text: "New main-thread thought", attachments: [] },
                kind: "human",
                created_at: "2026-07-31T00:00:05.000Z",
              },
              5,
              "user_2"
            ),
          ]}
          loadWhiteboardEditorAdapter={loadWhiteboardEditorAdapter}
          loadWhiteboardSession={loadWhiteboardSession}
        />
      </LangProvider>
    );
    expect(
      screen.getByLabelText(/new main conversation activity/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /main conversation/i }));
    expect(
      screen.queryByLabelText(/new main conversation activity/i)
    ).not.toBeInTheDocument();
  });

  it("establishes the replay baseline before flagging streaming turn updates", async () => {
    const loadWhiteboardEditorAdapter = vi.fn(async () => ({
      mount() {
        return {
          getScene: () => ({ elements: [], appState: {}, files: {} }),
          updateScene: () => {},
          subscribeSceneChanges: () => () => {},
          subscribePresenceChanges: () => () => {},
          setCollaborators: () => {},
          focusViewport: () => {},
          setDisplayOptions: () => {},
          setReadOnly: () => {},
          exportScene: async () => new Blob(),
          destroy: () => {},
        };
      },
    }));
    const historicalStreamingEvents = [
      ...workspaceProps.events,
      event(
        "agent.turn.started",
        { turn_id: "turn_1", agent_id: "agent_1" },
        5,
        "agent_1"
      ),
      event(
        "agent.output.delta",
        { turn_id: "turn_1", agent_id: "agent_1", chunk: "First" },
        6,
        "agent_1"
      ),
    ];
    const view = render(
      <LangProvider>
        <Workspace
          {...workspaceProps}
          eventReplayReady={false}
          loadWhiteboardEditorAdapter={loadWhiteboardEditorAdapter}
        />
      </LangProvider>
    );
    fireEvent.click(screen.getByRole("tab", { name: /whiteboard/i }));
    await waitFor(() =>
      expect(loadWhiteboardEditorAdapter).toHaveBeenCalledTimes(1)
    );
    await act(async () => {});

    view.rerender(
      <LangProvider>
        <Workspace
          {...workspaceProps}
          events={historicalStreamingEvents}
          eventReplayReady={false}
          loadWhiteboardEditorAdapter={loadWhiteboardEditorAdapter}
        />
      </LangProvider>
    );
    expect(
      screen.queryByLabelText(/new main conversation activity/i)
    ).not.toBeInTheDocument();

    view.rerender(
      <LangProvider>
        <Workspace
          {...workspaceProps}
          events={historicalStreamingEvents}
          eventReplayReady
          loadWhiteboardEditorAdapter={loadWhiteboardEditorAdapter}
        />
      </LangProvider>
    );
    expect(
      screen.queryByLabelText(/new main conversation activity/i)
    ).not.toBeInTheDocument();

    view.rerender(
      <LangProvider>
        <Workspace
          {...workspaceProps}
          events={[
            ...historicalStreamingEvents,
            event(
              "agent.output.delta",
              { turn_id: "turn_1", agent_id: "agent_1", chunk: " update" },
              7,
              "agent_1"
            ),
          ]}
          eventReplayReady
          loadWhiteboardEditorAdapter={loadWhiteboardEditorAdapter}
        />
      </LangProvider>
    );
    expect(
      screen.getByLabelText(/new main conversation activity/i)
    ).toBeInTheDocument();
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
