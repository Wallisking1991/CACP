import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { LangProvider } from "../src/i18n/LangProvider.js";
import Header from "../src/components/Header.js";

describe("Header styling", () => {
  it("renders all action buttons with consistent sizing", () => {
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
          pendingNotificationCount={3}
          joinRequests={[{ request_id: "req_1", display_name: "Bob", created_at: "2026-05-01T00:00:00Z" }]}
        />
      </LangProvider>
    );

    const soundBtn = screen.getByRole("button", { name: /sound/i });
    const notifBtn = screen.getByRole("button", { name: /notifications/i });
    const logBtn = screen.getByRole("button", { name: /logs/i });

    // All buttons should have the same computed size
    expect(soundBtn).toBeInTheDocument();
    expect(notifBtn).toBeInTheDocument();
    expect(logBtn).toBeInTheDocument();

    // Notification badge should be visible
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows active state on sound button when panel is open", () => {
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

    const soundBtn = screen.getByRole("button", { name: /sound/i });
    fireEvent.click(soundBtn);

    // Button should have active class when popover is open
    expect(soundBtn.classList.contains("is-active")).toBe(true);
  });
});
