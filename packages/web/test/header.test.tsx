import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { LangProvider } from "../src/i18n/LangProvider.js";
import Header from "../src/components/Header.js";

describe("Header", () => {
  it("renders sound, notification, and log buttons", () => {
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

    expect(screen.getByRole("button", { name: /sound/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /notifications/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /logs/i })).toBeInTheDocument();
  });

  it("shows notification badge when pending requests exist", () => {
    render(
      <LangProvider>
        <Header
          roomName="Test Room"
          roomId="room_1"
          avatarStatuses={[]}
          onCopyRoomId={vi.fn()}
          pendingNotificationCount={3}
        />
      </LangProvider>
    );

    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("opens sound panel when sound button is clicked", () => {
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

    fireEvent.click(screen.getByRole("button", { name: /sound/i }));
    expect(screen.getByRole("slider", { name: /volume/i })).toBeInTheDocument();
  });
});
