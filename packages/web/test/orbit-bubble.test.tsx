import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { OrbitBubble } from "../src/components/OrbitBubble.js";

describe("OrbitBubble", () => {
  it("renders message text", () => {
    render(<OrbitBubble text="Hello from orbit!" />);
    expect(screen.getByText("Hello from orbit!")).toBeInTheDocument();
  });

  it("truncates long text with ellipsis", () => {
    const longText = "a".repeat(300);
    render(<OrbitBubble text={longText} />);
    const bubble = document.querySelector(".orbit-bubble__text") as HTMLElement;
    expect(bubble).toBeInTheDocument();
  });

  it("has fade-in animation class on mount", () => {
    const { container } = render(<OrbitBubble text="Hi" />);
    expect(container.querySelector(".orbit-bubble")).toHaveClass("orbit-bubble--enter");
  });

  it("calls onDismiss after exit animation", async () => {
    const onDismiss = vi.fn();
    const { container } = render(<OrbitBubble text="Bye" onDismiss={onDismiss} durationMs={50} />);

    // wait for exit phase (duration + small buffer)
    await waitFor(() => {
      expect(container.querySelector(".orbit-bubble")).toHaveClass("orbit-bubble--exit");
    }, { timeout: 200 });

    // simulate animationend
    const bubble = container.querySelector(".orbit-bubble") as HTMLElement;
    bubble.dispatchEvent(new Event("animationend", { bubbles: true }));

    expect(onDismiss).toHaveBeenCalled();
  });
});
