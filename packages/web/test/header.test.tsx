import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { LangProvider } from "../src/i18n/LangProvider.js";
import Header from "../src/components/Header.js";

describe("Header", () => {
  it("renders MoreMenu button", () => {
    render(
      <LangProvider>
        <Header
          roomName="Test Room"
          roomId="room_1"
          avatarStatuses={[]}
          onCopyRoomId={vi.fn()}
          soundEnabled={true}
          soundVolume={0.5}
          onSoundEnabledChange={vi.fn()}
          onSoundVolumeChange={vi.fn()}
          onTestSound={vi.fn()}
        />
      </LangProvider>
    );

    expect(screen.getByRole("button", { name: /more options/i })).toBeInTheDocument();
  });

  it("renders notification button separately from MoreMenu", () => {
    render(
      <LangProvider>
        <Header
          roomName="Test Room"
          roomId="room_1"
          avatarStatuses={[]}
          onCopyRoomId={vi.fn()}
          pendingNotificationCount={3}
          joinRequests={[{ request_id: "req_1", display_name: "Bob", created_at: "2026-05-01T00:00:00Z" }]}
        />
      </LangProvider>
    );

    expect(screen.getByRole("button", { name: /notifications/i })).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("does not render sound or log buttons separately", () => {
    render(
      <LangProvider>
        <Header
          roomName="Test Room"
          roomId="room_1"
          avatarStatuses={[]}
          onCopyRoomId={vi.fn()}
          soundEnabled={true}
          soundVolume={0.5}
          onSoundEnabledChange={vi.fn()}
          onSoundVolumeChange={vi.fn()}
          onTestSound={vi.fn()}
        />
      </LangProvider>
    );

    expect(screen.queryByRole("button", { name: /^sound$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /logs/i })).not.toBeInTheDocument();
  });

  it("opens notification panel when notification button is clicked", () => {
    render(
      <LangProvider>
        <Header
          roomName="Test Room"
          roomId="room_1"
          avatarStatuses={[]}
          onCopyRoomId={vi.fn()}
          pendingNotificationCount={1}
          joinRequests={[{ request_id: "req_1", display_name: "Bob", created_at: "2026-05-01T00:00:00Z" }]}
          onApproveJoinRequest={vi.fn()}
          onRejectJoinRequest={vi.fn()}
        />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("renders notification button even with zero pending notifications", () => {
    render(
      <LangProvider>
        <Header
          roomName="Test Room"
          roomId="room_1"
          avatarStatuses={[]}
          onCopyRoomId={vi.fn()}
          pendingNotificationCount={0}
        />
      </LangProvider>
    );

    expect(screen.getByRole("button", { name: /notifications/i })).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("opens sound settings through MoreMenu", () => {
    render(
      <LangProvider>
        <Header
          roomName="Test Room"
          roomId="room_1"
          avatarStatuses={[]}
          onCopyRoomId={vi.fn()}
          soundEnabled={true}
          soundVolume={0.5}
          onSoundEnabledChange={vi.fn()}
          onSoundVolumeChange={vi.fn()}
          onTestSound={vi.fn()}
        />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    fireEvent.click(screen.getByText(/Sound/));
    expect(screen.getByRole("slider", { name: /volume/i })).toBeInTheDocument();
  });
});
