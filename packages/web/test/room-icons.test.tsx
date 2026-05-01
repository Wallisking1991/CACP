import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { BellIcon } from "../src/components/RoomIcons.js";

describe("RoomIcons", () => {
  it("BellIcon renders a bell SVG", () => {
    render(<BellIcon title="Notifications" />);
    const svg = screen.getByRole("img", { name: "Notifications" });
    expect(svg).toBeInTheDocument();
    expect(svg.tagName.toLowerCase()).toBe("svg");
  });
});
