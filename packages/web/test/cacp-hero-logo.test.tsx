import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CacpHeroLogo from "../src/components/CacpHeroLogo.js";

describe("CacpHeroLogo", () => {
  it("renders the CACP protocol room logo with an accessible label", () => {
    render(<CacpHeroLogo />);

    expect(
      screen.getByLabelText("CACP protocol room logo")
    ).toBeInTheDocument();
    expect(screen.getByText("CACP")).toBeInTheDocument();
  });

  it("keeps the animated SVG details decorative", () => {
    const { container } = render(<CacpHeroLogo />);

    expect(container.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true"
    );
    expect(container.querySelectorAll(".logo-draw")).toHaveLength(6);
    expect(container.querySelectorAll(".logo-node")).toHaveLength(3);
  });

  it("supports a caller-provided accessible label", () => {
    render(<CacpHeroLogo ariaLabel="CACP collaboration mark" />);

    expect(
      screen.getByLabelText("CACP collaboration mark")
    ).toBeInTheDocument();
  });
});
