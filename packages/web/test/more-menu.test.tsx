import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MoreMenu } from "../src/components/MoreMenu.js";

describe("MoreMenu", () => {
  it("renders more menu button", () => {
    render(<MoreMenu />);
    const button = screen.getByRole("button", { name: /More options/i });
    expect(button).toBeInTheDocument();
  });

  it("opens menu when button is clicked", () => {
    render(<MoreMenu />);
    const button = screen.getByRole("button", { name: /More options/i });
    fireEvent.click(button);
    expect(screen.getByText(/Sound/i)).toBeInTheDocument();
    expect(screen.getByText(/Logs/i)).toBeInTheDocument();
    expect(screen.getByText(/Language/i)).toBeInTheDocument();
    expect(screen.getByText(/Leave room/i)).toBeInTheDocument();
    expect(screen.queryByText(/Notifications/i)).not.toBeInTheDocument();
  });

  it("does not show notification badge on button", () => {
    render(<MoreMenu />);
    const badge = document.querySelector(".more-menu-badge");
    expect(badge).not.toBeInTheDocument();
  });

  it("shows SoundPanel when sound menu item is clicked", () => {
    render(
      <MoreMenu
        soundEnabled={true}
        soundVolume={0.5}
        onSoundEnabledChange={() => {}}
        onSoundVolumeChange={() => {}}
        onTestSound={() => {}}
      />
    );
    const button = screen.getByRole("button", { name: /More options/i });
    fireEvent.click(button);
    fireEvent.click(screen.getByText(/Sound/i));
    expect(screen.getByLabelText(/Volume/i)).toBeInTheDocument();
  });

  it("returns to main menu from SoundPanel via back button", () => {
    render(
      <MoreMenu
        soundEnabled={true}
        soundVolume={0.5}
        onSoundEnabledChange={() => {}}
        onSoundVolumeChange={() => {}}
        onTestSound={() => {}}
      />
    );
    const button = screen.getByRole("button", { name: /More options/i });
    fireEvent.click(button);
    fireEvent.click(screen.getByText(/Sound/i));
    expect(screen.getByLabelText(/Volume/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Back/i));
    expect(screen.getByText(/Sound/i)).toBeInTheDocument();
    expect(screen.getByText(/Logs/i)).toBeInTheDocument();
  });

  it("calls onToggleLang when language item is clicked", () => {
    const onToggleLang = vi.fn();
    render(<MoreMenu currentLang="en" onToggleLang={onToggleLang} />);
    const button = screen.getByRole("button", { name: /More options/i });
    fireEvent.click(button);
    fireEvent.click(screen.getByText(/Language/i));
    expect(onToggleLang).toHaveBeenCalledTimes(1);
  });

  it("calls onLeaveRoom when leave item is clicked", () => {
    const onLeaveRoom = vi.fn();
    render(<MoreMenu onLeaveRoom={onLeaveRoom} />);
    const button = screen.getByRole("button", { name: /More options/i });
    fireEvent.click(button);
    fireEvent.click(screen.getByText(/Leave room/i));
    expect(onLeaveRoom).toHaveBeenCalledTimes(1);
  });

  it("closes menu when leave is clicked", () => {
    const onLeaveRoom = vi.fn();
    render(<MoreMenu onLeaveRoom={onLeaveRoom} />);
    const button = screen.getByRole("button", { name: /More options/i });
    fireEvent.click(button);
    fireEvent.click(screen.getByText(/Leave room/i));
    expect(screen.queryByText(/Sound/i)).not.toBeInTheDocument();
  });
});
