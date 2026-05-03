import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OrbitToggleTab } from "../src/components/OrbitToggleTab.js";
import { LangProvider } from "../src/i18n/LangProvider.js";

describe("OrbitToggleTab", () => {
  it("renders as an accessible toggle with capped unread count", () => {
    const onClick = vi.fn();
    render(<LangProvider><OrbitToggleTab open={false} unreadCount={12} onClick={onClick} /></LangProvider>);
    const button = screen.getByRole("button", { name: /Toggle discussion/i });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("9+")).toBeInTheDocument();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
