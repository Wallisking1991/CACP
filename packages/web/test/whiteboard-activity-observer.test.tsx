import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhiteboardActivityObserver } from "../src/components/WhiteboardActivityObserver.js";
import type { WhiteboardSessionController } from "../src/whiteboard/whiteboard-session.js";

function controller(): WhiteboardSessionController {
  return {
    subscribeStatus: () => () => {},
    subscribeCollaborators: () => () => {},
    subscribeActivity: () => () => {},
    focusCollaborator: () => {},
    loadSharedScene: () => {},
    setRole: () => {},
    setPresenceEnabled: () => {},
    destroy: vi.fn(),
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("WhiteboardActivityObserver", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries a transient session loader failure", async () => {
    vi.useFakeTimers();
    const session = controller();
    const createSession = vi.fn(() => session);
    const loadSession = vi
      .fn()
      .mockRejectedValueOnce(new Error("stale deployment chunk"))
      .mockResolvedValue(createSession);

    render(
      <WhiteboardActivityObserver
        identity={{
          participantId: "user_1",
          role: "owner",
          roomId: "room_1",
          token: "owner_secret",
        }}
        loadSession={loadSession}
        onActivity={() => {}}
        onCollaboratorsChange={() => {}}
      />
    );

    await act(flushPromises);
    expect(loadSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await flushPromises();
    });

    expect(loadSession).toHaveBeenCalledTimes(2);
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        observeOnly: true,
        presenceEnabled: false,
      })
    );
  });

  it("cancels a pending loader retry when unmounted", async () => {
    vi.useFakeTimers();
    const loadSession = vi.fn().mockRejectedValue(new Error("offline"));
    const view = render(
      <WhiteboardActivityObserver
        identity={{
          participantId: "user_1",
          role: "owner",
          roomId: "room_1",
          token: "owner_secret",
        }}
        loadSession={loadSession}
        onActivity={() => {}}
        onCollaboratorsChange={() => {}}
      />
    );

    await act(flushPromises);
    expect(loadSession).toHaveBeenCalledTimes(1);
    view.unmount();

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await flushPromises();
    });

    expect(loadSession).toHaveBeenCalledTimes(1);
  });
});
