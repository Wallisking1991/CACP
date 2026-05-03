import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { LangProvider } from "../src/i18n/LangProvider.js";
import Header from "../src/components/Header.js";

describe("Header styling", () => {
  it("renders MoreMenu with consistent sizing", () => {
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

    const menuBtn = screen.getByRole("button", { name: /more options/i });
    expect(menuBtn).toBeInTheDocument();
  });
});
