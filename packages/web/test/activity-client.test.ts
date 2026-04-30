import { afterEach, describe, expect, it, vi } from "vitest";
import { createTypingActivityController } from "../src/activity-client.js";

describe("typing activity controller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts typing once and stops after inactivity", () => {
    vi.useFakeTimers();
    const start = vi.fn();
    const stop = vi.fn();
    const controller = createTypingActivityController({ startTyping: start, stopTyping: stop, stopDelayMs: 2000 });

    controller.inputChanged("h");
    controller.inputChanged("he");
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1999);
    expect(stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("stops immediately after send or clear", () => {
    vi.useFakeTimers();
    const start = vi.fn();
    const stop = vi.fn();
    const controller = createTypingActivityController({ startTyping: start, stopTyping: stop, stopDelayMs: 2000 });

    controller.inputChanged("hello");
    controller.stopNow();
    expect(stop).toHaveBeenCalledTimes(1);

    controller.inputChanged("again");
    controller.inputChanged("");
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
