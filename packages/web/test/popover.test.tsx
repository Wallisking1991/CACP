import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { useRef, useState } from "react";
import { Popover } from "../src/components/Popover.js";

describe("Popover", () => {
  it("does not render content when closed", () => {
    function TestComponent() {
      const triggerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={triggerRef}>Trigger</button>
          <Popover triggerRef={triggerRef} open={false} onClose={vi.fn()}>
            <div data-testid="popover-content">Content</div>
          </Popover>
        </>
      );
    }
    render(<TestComponent />);
    expect(screen.queryByTestId("popover-content")).not.toBeInTheDocument();
  });

  it("renders content in a portal when open", () => {
    function TestComponent() {
      const triggerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={triggerRef}>Trigger</button>
          <Popover triggerRef={triggerRef} open={true} onClose={vi.fn()}>
            <div data-testid="popover-content">Content</div>
          </Popover>
        </>
      );
    }
    render(<TestComponent />);
    expect(screen.getByTestId("popover-content")).toBeInTheDocument();
  });

  it("calls onClose when clicking outside the popover", () => {
    const onClose = vi.fn();
    function TestComponent() {
      const triggerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={triggerRef}>Trigger</button>
          <div data-testid="outside">Outside</div>
          <Popover triggerRef={triggerRef} open={true} onClose={onClose}>
            <div data-testid="popover-content">Content</div>
          </Popover>
        </>
      );
    }
    render(<TestComponent />);
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalled();
  });

  it("does not call onClose when clicking inside the popover", () => {
    const onClose = vi.fn();
    function TestComponent() {
      const triggerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={triggerRef}>Trigger</button>
          <Popover triggerRef={triggerRef} open={true} onClose={onClose}>
            <div data-testid="popover-content">Content</div>
          </Popover>
        </>
      );
    }
    render(<TestComponent />);
    fireEvent.mouseDown(screen.getByTestId("popover-content"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("positions the popover near the trigger element", () => {
    function TestComponent() {
      const triggerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button
            ref={triggerRef}
            style={{ position: "fixed", top: 100, left: 200 }}
          >
            Trigger
          </button>
          <Popover triggerRef={triggerRef} open={true} onClose={vi.fn()}>
            <div data-testid="popover-content">Content</div>
          </Popover>
        </>
      );
    }
    render(<TestComponent />);
    const content = screen
      .getByTestId("popover-content")
      .closest("[data-popover='true']") as HTMLElement;
    expect(content).toBeInTheDocument();
    // Position should be computed based on trigger rect
    expect(content.style.position).toBe("fixed");
  });

  it("repositions an open popover when the viewport changes", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1_000,
    });
    function TestComponent() {
      const triggerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button
            ref={(element) => {
              triggerRef.current = element;
              if (element) {
                element.getBoundingClientRect = () =>
                  ({
                    bottom: 132,
                    height: 32,
                    left: 900,
                    right: 932,
                    top: 100,
                    width: 32,
                    x: 900,
                    y: 100,
                    toJSON: () => ({}),
                  }) as DOMRect;
              }
            }}
          >
            Trigger
          </button>
          <Popover triggerRef={triggerRef} open={true} onClose={vi.fn()}>
            <div data-testid="popover-content">Content</div>
          </Popover>
        </>
      );
    }
    render(<TestComponent />);
    const panel = screen
      .getByTestId("popover-content")
      .closest("[data-popover='true']") as HTMLElement;
    await waitFor(() => expect(panel.style.left).toBe("672px"));

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 375,
    });
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(panel.style.left).toBe("47px"));

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalInnerWidth,
    });
  });

  it("calls onClose after mouse leaves the popover panel for 2 seconds", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    function TestComponent() {
      const triggerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={triggerRef}>Trigger</button>
          <Popover triggerRef={triggerRef} open={true} onClose={onClose}>
            <div data-testid="popover-content">Content</div>
          </Popover>
        </>
      );
    }
    render(<TestComponent />);
    const panel = screen
      .getByTestId("popover-content")
      .closest("[data-popover='true']") as HTMLElement;

    fireEvent.mouseLeave(panel);
    expect(onClose).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1999);
    expect(onClose).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onClose).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });

  it("calls onClose after mouse leaves the trigger for 2 seconds", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    function TestComponent() {
      const triggerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={triggerRef} data-testid="trigger">
            Trigger
          </button>
          <Popover triggerRef={triggerRef} open={true} onClose={onClose}>
            <div data-testid="popover-content">Content</div>
          </Popover>
        </>
      );
    }
    render(<TestComponent />);

    fireEvent.mouseLeave(screen.getByTestId("trigger"));
    vi.advanceTimersByTime(2000);

    expect(onClose).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });

  it("cancels onClose when mouse re-enters during the delay", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    function TestComponent() {
      const triggerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={triggerRef}>Trigger</button>
          <Popover triggerRef={triggerRef} open={true} onClose={onClose}>
            <div data-testid="popover-content">Content</div>
          </Popover>
        </>
      );
    }
    render(<TestComponent />);
    const panel = screen
      .getByTestId("popover-content")
      .closest("[data-popover='true']") as HTMLElement;

    fireEvent.mouseLeave(panel);
    vi.advanceTimersByTime(1000);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseEnter(panel);
    vi.advanceTimersByTime(2000);
    expect(onClose).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
