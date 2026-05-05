import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import AgentRippleOverlay from "../src/components/AgentRippleOverlay.js";

describe("AgentRippleOverlay", () => {
  let avatarEl: HTMLDivElement;

  beforeEach(() => {
    avatarEl = document.createElement("div");
    avatarEl.setAttribute("data-avatar-id", "agent-1");
    avatarEl.setAttribute("data-agent-active", "true");
    document.body.appendChild(avatarEl);
    avatarEl.getBoundingClientRect = vi.fn(() => ({
      left: 100,
      top: 50,
      width: 40,
      height: 40,
      right: 140,
      bottom: 90,
      x: 100,
      y: 50,
      toJSON: () => {},
    }));
  });

  afterEach(() => {
    if (avatarEl.parentNode) {
      document.body.removeChild(avatarEl);
    }
  });

  it("renders nothing when no working agents", () => {
    const { container } = render(
      <AgentRippleOverlay
        avatarStatuses={[]}
        turnInFlight={false}
      />
    );
    expect(container.querySelector(".agent-ripple-overlay")).toBeNull();
  });

  it("renders fullscreen overlay when a working agent exists", () => {
    const { container } = render(
      <AgentRippleOverlay
        avatarStatuses={[
          {
            id: "agent-1",
            kind: "agent",
            status: "working",
            display_name: "Test",
            group: "agents",
            active: true,
          },
        ]}
        turnInFlight={true}
      />
    );

    const overlay = container.querySelector(".agent-ripple-overlay");
    expect(overlay).not.toBeNull();
  });

  it("renders two wave layers per working agent", () => {
    const { container } = render(
      <AgentRippleOverlay
        avatarStatuses={[
          {
            id: "agent-1",
            kind: "agent",
            status: "working",
            display_name: "Test",
            group: "agents",
            active: true,
          },
        ]}
        turnInFlight={true}
      />
    );

    const waves = container.querySelectorAll(".agent-wave-layer");
    expect(waves.length).toBe(2);
  });

  it("does not render overlay when agent is idle", () => {
    const { container } = render(
      <AgentRippleOverlay
        avatarStatuses={[
          {
            id: "agent-1",
            kind: "agent",
            status: "idle",
            display_name: "Test",
            group: "agents",
            active: true,
          },
        ]}
        turnInFlight={false}
      />
    );

    expect(container.querySelector(".agent-ripple-overlay")).toBeNull();
  });
});
