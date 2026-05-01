import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { FloatingLogoControl } from "../src/components/FloatingLogoControl.js";

describe("FloatingLogoControl", () => {
  it("opens controls and persists vertical position after keyboard nudging", () => {
    const onOpen = vi.fn();
    render(<FloatingLogoControl active={false} pendingCount={1} onOpen={onOpen} storageKey="test.logo.y" />);

    const button = screen.getByRole("button", { name: /CACP/i });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(button, { key: "ArrowDown" });
    expect(localStorage.getItem("test.logo.y")).toBe("52");
  });
});
