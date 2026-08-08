import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { workspaceModuleLoaded } = vi.hoisted(() => ({
  workspaceModuleLoaded: vi.fn(),
}));

vi.mock("../src/components/Workspace.js", () => {
  workspaceModuleLoaded();
  return { default: () => null };
});

describe("App route loading", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders Landing without loading the Workspace implementation", async () => {
    const { default: App } = await import("../src/App.js");

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByTestId("landing-create-card")).toBeInTheDocument();
    expect(workspaceModuleLoaded).not.toHaveBeenCalled();
  });
});
