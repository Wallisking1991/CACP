import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.js";

vi.mock("../src/runtime-config.js", () => ({
  isCloudMode: () => true
}));

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return {
    ...actual,
    createRoom: vi.fn(async () => ({
      room_id: "room_1",
      token: "owner_secret",
      participant_id: "user_owner",
      role: "owner"
    })),
    createAgentPairing: vi.fn(async () => ({
      connection_code: "CACP-CONNECT:v1:full-secret-code",
      download_url: "/downloads/CACP-Local-Connector.exe",
      expires_at: "2026-04-28T04:30:00.000Z"
    })),
    connectEvents: vi.fn(() => ({
      readyState: 1,
      close: vi.fn(),
      addEventListener: vi.fn()
    })),
    clearEventSocket: vi.fn()
  };
});

describe("App connector onboarding modal", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => undefined) },
      configurable: true
    });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("opens the connector modal after cloud room creation generates a connection code", async () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Owner" } });
    fireEvent.click(screen.getByRole("button", { name: "Create room and generate connector command" }));

    expect(await screen.findByRole("dialog", { name: "Connect local Agent" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download CACP-Local-Connector.exe" })).toHaveAttribute("href", "/downloads/CACP-Local-Connector.exe");
    fireEvent.click(screen.getByRole("button", { name: "Copy connection code" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("CACP-CONNECT:v1:full-secret-code"));
  });
});
