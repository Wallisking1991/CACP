import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import App from "../src/App.js";

function mockFetch(response: unknown, ok = true): void {
  vi.stubGlobal("fetch", vi.fn(() =>
    Promise.resolve({ ok, json: () => Promise.resolve(response), text: () => Promise.resolve("error") } as Response)
  ));
}

function mockWebSocket(): void {
  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = MockWebSocket.OPEN;
    close = vi.fn();
    send = vi.fn();
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
  }
  vi.stubGlobal("WebSocket", MockWebSocket);
}

describe("App routing", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockWebSocket();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders Landing at root path", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    );
    expect(screen.getByTestId("landing-create-card")).toBeInTheDocument();
  });

  it("renders Workspace when valid session exists for roomId", async () => {
    const session = {
      room_id: "room_abc",
      token: "token_abc",
      participant_id: "pid_abc",
      role: "owner" as const,
    };
    window.localStorage.setItem("cacp.sessions", JSON.stringify({ room_abc: session }));
    mockFetch({ room_id: "room_abc", name: "Test Room", role: "owner", participant_id: "pid_abc" });

    render(
      <MemoryRouter initialEntries={["/room/room_abc"]} initialIndex={0}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.queryByTestId("landing-create-card")).not.toBeInTheDocument();
    });
  });

  it("redirects to Landing when no session for roomId", async () => {
    render(
      <MemoryRouter initialEntries={["/room/room_xyz"]} initialIndex={0}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("landing-create-card")).toBeInTheDocument();
    });
  });

  it("redirects to Landing when session validation fails", async () => {
    const session = {
      room_id: "room_abc",
      token: "bad_token",
      participant_id: "pid_abc",
      role: "member" as const,
    };
    window.localStorage.setItem("cacp.sessions", JSON.stringify({ room_abc: session }));
    mockFetch({}, false);

    render(
      <MemoryRouter initialEntries={["/room/room_abc"]} initialIndex={0}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("landing-create-card")).toBeInTheDocument();
    });
  });
});
