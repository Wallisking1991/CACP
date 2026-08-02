import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WhiteboardSurface } from "../src/components/WhiteboardSurface.js";
import type {
  WhiteboardEditorController,
  WhiteboardScene,
} from "../src/whiteboard/whiteboard-editor-adapter.js";
import type { WhiteboardSessionController } from "../src/whiteboard/whiteboard-session.js";

function sessionController(): WhiteboardSessionController {
  return {
    subscribeStatus(listener) {
      listener("connected");
      return () => {};
    },
    subscribeCollaborators(listener) {
      listener([]);
      return () => {};
    },
    subscribeActivity: () => () => {},
    subscribeError: () => () => {},
    focusCollaborator: () => {},
    loadSharedScene: () => {},
    setRole: () => {},
    setPresenceEnabled: () => {},
    destroy: () => {},
  };
}

function editorController(options?: {
  insertTemplate?: WhiteboardEditorController["insertTemplate"];
  onSceneListener?: (listener: (scene: WhiteboardScene) => void) => void;
}): WhiteboardEditorController {
  return {
    getScene: () => ({ elements: [], appState: {}, files: {} }),
    updateScene: () => {},
    resetHistory: () => {},
    subscribeSceneChanges(listener) {
      options?.onSceneListener?.(listener);
      return () => {};
    },
    subscribePresenceChanges: () => () => {},
    setCollaborators: () => {},
    focusViewport: () => {},
    insertTemplate: options?.insertTemplate,
    setDisplayOptions: () => {},
    setReadOnly: () => {},
    exportScene: async () => new Blob(),
    destroy: () => {},
  };
}

function surface(
  participantId: string,
  role: "owner" | "admin" | "member" | "observer",
  controller: WhiteboardEditorController
) {
  return (
    <WhiteboardSurface
      active
      identity={{
        roomId: "room_templates",
        participantId,
        token: "secret",
        role,
      }}
      loadEditorAdapter={async () => ({ mount: async () => controller })}
      loadSession={async () => () => sessionController()}
      langCode="en"
      name="Template room"
    />
  );
}

describe("whiteboard onboarding and built-in templates", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("keeps first-entry dismissal participant-local without changing the blank scene", async () => {
    const controller = editorController();
    const first = render(surface("member_a", "member", controller));
    expect(await screen.findByText("Start shaping the idea")).toBeVisible();
    expect(controller.getScene().elements).toEqual([]);
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss whiteboard introduction" })
    );
    expect(
      screen.queryByText("Start shaping the idea")
    ).not.toBeInTheDocument();
    first.unmount();

    const sameParticipant = render(surface("member_a", "member", controller));
    await waitFor(() =>
      expect(
        screen.queryByText("Start shaping the idea")
      ).not.toBeInTheDocument()
    );
    sameParticipant.unmount();

    render(surface("member_b", "member", controller));
    expect(await screen.findByText("Start shaping the idea")).toBeVisible();
  });

  it("dismisses the local introduction after the first meaningful edit", async () => {
    let sceneListener: ((scene: WhiteboardScene) => void) | undefined;
    const controller = editorController({
      onSceneListener(listener) {
        sceneListener = listener;
      },
    });
    render(surface("member_edit", "member", controller));
    expect(await screen.findByText("Start shaping the idea")).toBeVisible();

    act(() => sceneListener?.({ elements: [], appState: {}, files: {} }));
    expect(screen.getByText("Start shaping the idea")).toBeVisible();
    act(() =>
      sceneListener?.({
        elements: [{ id: "shape_1", isDeleted: false }],
        appState: {},
        files: {},
      })
    );
    expect(
      screen.queryByText("Start shaping the idea")
    ).not.toBeInTheDocument();
  });

  it("lets human editors insert a trusted template and hides insertion from observers", async () => {
    const insertTemplate = vi.fn(async () => {});
    const member = render(
      surface("member_insert", "member", editorController({ insertTemplate }))
    );
    const templatesButton = await screen.findByRole("button", {
      name: "Templates",
    });
    fireEvent.click(templatesButton);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Built-in templates" })
    ).not.toBeInTheDocument();
    await waitFor(() => expect(templatesButton).toHaveFocus());

    fireEvent.click(templatesButton);
    const menu = screen.getByRole("dialog", { name: "Built-in templates" });
    fireEvent.click(within(menu).getByRole("button", { name: /Brainstorm/u }));
    await waitFor(() => expect(insertTemplate).toHaveBeenCalledTimes(1));
    expect(insertTemplate).toHaveBeenCalledWith("brainstorm");
    expect(
      screen.queryByRole("dialog", { name: "Built-in templates" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Start shaping the idea")
    ).not.toBeInTheDocument();
    member.unmount();

    render(surface("observer_a", "observer", editorController()));
    await screen.findByText("Start shaping the idea");
    expect(
      screen.queryByRole("button", { name: "Templates" })
    ).not.toBeInTheDocument();
  });
});
