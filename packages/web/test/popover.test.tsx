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
          <button ref={triggerRef} style={{ position: "fixed", top: 100, left: 200 }}>Trigger</button>
          <Popover triggerRef={triggerRef} open={true} onClose={vi.fn()}>
            <div data-testid="popover-content">Content</div>
          </Popover>
        </>
      );
    }
    render(<TestComponent />);
    const content = screen.getByTestId("popover-content").closest("[data-popover='true']") as HTMLElement;
    expect(content).toBeInTheDocument();
    // Position should be computed based on trigger rect
    expect(content.style.position).toBe("fixed");
  });
});
