import { act, fireEvent, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Thread from "../src/components/Thread.js";
import { LangProvider } from "../src/i18n/LangProvider.js";

const originalScrollIntoView = Element.prototype.scrollIntoView;

function thread(text: string) {
  return (
    <LangProvider>
      <Thread
        currentParticipantId="user_1"
        messages={[]}
        streamingTurns={[
          {
            turn_id: "turn_1",
            agent_id: "agent_1",
            text,
            phase: "generating_answer",
          },
        ]}
        actorNames={new Map([["agent_1", "Codex"]])}
      />
    </LangProvider>
  );
}

describe("Thread autoscroll", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("coalesces live output autoscroll into one non-smooth frame update", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    let nextFrameId = 1;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        const id = nextFrameId;
        nextFrameId += 1;
        frames.set(id, callback);
        return id;
      })
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => {
        frames.delete(id);
      })
    );

    const view = render(thread("a"));
    act(() => {
      for (const callback of frames.values()) callback(0);
      frames.clear();
    });
    scrollIntoView.mockClear();

    view.rerender(thread("ab"));
    view.rerender(thread("abc"));
    view.rerender(thread("abcd"));

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);

    act(() => {
      for (const callback of frames.values()) callback(16);
      frames.clear();
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto" });
  });

  it("keeps the reader's position while they review earlier messages", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    let nextFrameId = 1;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        const id = nextFrameId;
        nextFrameId += 1;
        frames.set(id, callback);
        return id;
      })
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => {
        frames.delete(id);
      })
    );

    const view = render(thread("a"));
    const scrollport = view.container.querySelector(".thread");
    expect(scrollport).not.toBeNull();
    Object.defineProperties(scrollport!, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1000 },
      scrollTop: { configurable: true, value: 100, writable: true },
    });
    act(() => {
      for (const callback of frames.values()) callback(0);
      frames.clear();
    });
    scrollIntoView.mockClear();

    fireEvent.scroll(scrollport!);
    view.rerender(thread("ab"));
    act(() => {
      for (const callback of frames.values()) callback(16);
      frames.clear();
    });

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
