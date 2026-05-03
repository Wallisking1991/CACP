import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OrbitClearConfirmDialog } from "../src/components/OrbitClearConfirmDialog.js";
import { LangProvider } from "../src/i18n/LangProvider.js";

describe("OrbitClearConfirmDialog", () => {
  it("confirms and cancels destructive clear", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<LangProvider><OrbitClearConfirmDialog open onConfirm={onConfirm} onCancel={onCancel} /></LangProvider>);
    expect(screen.getByRole("dialog", { name: /Clear discussion/i })).toHaveAttribute("aria-modal", "true");
    fireEvent.click(screen.getByRole("button", { name: /^Clear$/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
