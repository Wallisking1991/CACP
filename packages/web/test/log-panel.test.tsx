import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { LangProvider } from "../src/i18n/LangProvider.js";
import { LogPanel } from "../src/components/LogPanel.js";

describe("LogPanel", () => {
  it("renders placeholder text", () => {
    render(
      <LangProvider>
        <LogPanel />
      </LangProvider>
    );

    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });
});
