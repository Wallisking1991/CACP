import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CacpRoomLogo from "../src/components/CacpRoomLogo.js";

describe("CacpRoomLogo", () => {
  test("renders with default aria-label", () => {
    render(<CacpRoomLogo />);
    const logo = screen.getByLabelText("CACP");
    expect(logo).toBeInTheDocument();
  });

  test("renders SVG mark", () => {
    render(<CacpRoomLogo />);
    const svg = document.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  test("applies custom className", () => {
    render(<CacpRoomLogo className="my-custom-class" />);
    const logo = screen.getByLabelText("CACP");
    expect(logo).toHaveClass("my-custom-class");
  });

  test("uses custom aria-label when provided", () => {
    render(<CacpRoomLogo ariaLabel="Custom label" />);
    const logo = screen.getByLabelText("Custom label");
    expect(logo).toBeInTheDocument();
  });
});
