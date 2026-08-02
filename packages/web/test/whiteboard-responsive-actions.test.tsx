import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WhiteboardSurface } from "../src/components/WhiteboardSurface.js";
import { WorkspaceModeSwitch } from "../src/components/WorkspaceModeSwitch.js";
import type { WhiteboardEditorController } from "../src/whiteboard/whiteboard-editor-adapter.js";
import type {
  WhiteboardSessionController,
  WhiteboardSessionStatus,
} from "../src/whiteboard/whiteboard-session.js";

function viewport(width: number): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(max-width: 720px)" && width <= 720,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    }))
  );
}

function controller(): WhiteboardEditorController {
  return {
    getScene: () => ({ elements: [], appState: {}, files: {} }),
    updateScene: () => {},
    resetHistory: () => {},
    subscribeSceneChanges: () => () => {},
    subscribePresenceChanges: () => () => {},
    setCollaborators: () => {},
    focusViewport: () => {},
    insertImage: async () => {},
    insertTemplate: async () => {},
    createPromotionArtifacts: async () => ({
      selectedElementIds: ["shape_1"],
      png: new Blob(["png"], { type: "image/png" }),
      source: new Blob(["source"], {
        type: "application/vnd.excalidraw+json",
      }),
    }),
    setDisplayOptions: () => {},
    setReadOnly: () => {},
    exportScene: async () => new Blob(["export"]),
    destroy: () => {},
  };
}

function session(status: WhiteboardSessionStatus): WhiteboardSessionController {
  return {
    subscribeStatus(listener) {
      listener(status);
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
    currentRevision: () => 1,
    destroy: () => {},
  };
}

function surface(
  role: "owner" | "member" | "observer",
  status: WhiteboardSessionStatus = "connected",
  editorController: WhiteboardEditorController = controller()
) {
  return (
    <WhiteboardSurface
      active
      identity={{
        roomId: `room_${role}_${status}`,
        participantId: `${role}_1`,
        token: "secret",
        role,
      }}
      activeAgent={{
        agent_id: "agent_1",
        name: "Codex",
        capabilities: ["codex-cli"],
        status: "online",
        input_capabilities: {
          image: "native",
          pdf: "file_path",
          text: "file_path",
          office: "file_path",
          file: "file_path",
          max_attachments: 5,
        },
      }}
      loadEditorAdapter={async () => ({
        mount: async () => editorController,
      })}
      loadSession={async () => () => session(status)}
      langCode="en"
      name="Responsive whiteboard"
    />
  );
}

describe("responsive whiteboard actions", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it.each([768, 1024])(
    "keeps complete actions visible at the %ipx tablet or desktop viewport",
    async (width) => {
      viewport(width);
      render(surface("owner"));

      expect(
        await screen.findByRole("button", { name: "Add image" })
      ).toBeVisible();
      expect(screen.getByRole("button", { name: "Templates" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Recovery" })).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "More" })
      ).not.toBeInTheDocument();
    }
  );

  it("moves labeled advanced actions into a focus-restoring phone dialog", async () => {
    viewport(375);
    render(surface("owner"));

    const more = await screen.findByRole("button", { name: "More" });
    expect(
      screen.queryByRole("button", { name: "Templates" })
    ).not.toBeInTheDocument();
    fireEvent.click(more);
    const dialog = screen.getByRole("dialog", { name: "More" });
    expect(
      within(dialog).getByRole("button", { name: "Add image" })
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Templates" })
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Recovery" })
    ).toBeVisible();
    expect(within(dialog).getByLabelText("Export scope")).toBeVisible();
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Close" })
      ).toHaveFocus()
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Templates" }));
    expect(
      screen.queryByRole("dialog", { name: "More" })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Built-in templates" })
    ).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(more).toHaveFocus());

    fireEvent.click(more);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "More" })
    ).not.toBeInTheDocument();
    await waitFor(() => expect(more).toHaveFocus());
  });

  it("shows only export actions to phone observers and disables disconnected editing", async () => {
    viewport(375);
    const observer = render(surface("observer"));
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    let dialog = screen.getByRole("dialog", { name: "More" });
    expect(
      within(dialog).queryByRole("button", { name: "Add image" })
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Templates" })
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Recovery" })
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Export PNG" })
    ).toBeVisible();
    observer.unmount();

    render(surface("member", "disconnected"));
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    dialog = screen.getByRole("dialog", { name: "More" });
    expect(
      within(dialog).getByRole("button", { name: "Add image" })
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Templates" })
    ).toBeDisabled();
    expect(
      within(dialog).queryByRole("button", { name: "Recovery" })
    ).not.toBeInTheDocument();
  });

  it("reveals an empty-selection error after closing the phone action dialog", async () => {
    viewport(375);
    const emptySelection = controller();
    emptySelection.createPromotionArtifacts = async () => {
      throw new Error("whiteboard_export_empty_selection");
    };
    render(surface("owner", "connected", emptySelection));

    const more = await screen.findByRole("button", { name: "More" });
    fireEvent.click(more);
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "More" })).getByRole("button", {
        name: "Send selection to main conversation",
      })
    );

    expect(
      await screen.findByText(/select one or more whiteboard items/iu)
    ).toHaveAttribute("role", "alert");
    expect(
      screen.queryByRole("dialog", { name: "More" })
    ).not.toBeInTheDocument();
    await waitFor(() => expect(more).toHaveFocus());
  });

  it("focuses the selected workspace tab after a programmatic return", async () => {
    viewport(1024);
    const view = render(
      <WorkspaceModeSwitch mode="whiteboard" onChange={() => {}} />
    );
    view.rerender(
      <WorkspaceModeSwitch mode="conversation" onChange={() => {}} />
    );

    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Main conversation" })
      ).toHaveFocus()
    );
  });
});
