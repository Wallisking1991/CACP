import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentStatusBanner } from "../src/components/AgentStatusBanner.js";
import { LangProvider } from "../src/i18n/LangProvider.js";

function renderBanner(props: React.ComponentProps<typeof AgentStatusBanner>) {
  return render(
    <LangProvider>
      <AgentStatusBanner {...props} />
    </LangProvider>
  );
}

describe("AgentStatusBanner", () => {
  it("shows waiting for agent message when status is no_agent", () => {
    renderBanner({ status: "no_agent", isOwner: true });
    expect(screen.getByText(/Waiting for agent/i)).toBeInTheDocument();
  });

  it("shows selecting session message for owner", () => {
    renderBanner({
      status: "selecting_session",
      isOwner: true,
      providerLabel: "Claude Code",
    });
    expect(screen.getByText(/Select a session to start/i)).toBeInTheDocument();
  });

  it("shows waiting for owner message for non-owner", () => {
    renderBanner({
      status: "selecting_session",
      isOwner: false,
      providerLabel: "Claude Code",
    });
    expect(
      screen.getByText(/Waiting for owner to select a session/i)
    ).toBeInTheDocument();
  });

  it("renders nothing when status is ready", () => {
    const { container } = renderBanner({ status: "ready", isOwner: true });
    expect(container.firstChild).toBeNull();
  });
});
