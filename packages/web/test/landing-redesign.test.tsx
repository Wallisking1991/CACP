import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LangProvider } from "../src/i18n/LangProvider.js";
import Landing from "../src/components/Landing.js";

function renderLanding(props: Partial<React.ComponentProps<typeof Landing>> = {}) {
  const onCreate = vi.fn();
  const onJoin = vi.fn();
  render(
    <LangProvider>
      <Landing onCreate={onCreate} onJoin={onJoin} loading={false} {...props} />
    </LangProvider>
  );
  return { onCreate, onJoin };
}

describe("Landing redesign", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.pushState({}, "", "/");
  });

  it("shows a focused quick-create card without ordinary invite controls", () => {
    renderLanding();

    expect(screen.getByTestId("landing-create-card")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create a collaborative AI room" })).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toBeRequired();
    expect(screen.getByLabelText("Room name")).toHaveValue("CACP AI Room");
    expect(screen.queryByRole("button", { name: "Join with invite" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Invite link")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Room ID")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Invite token")).not.toBeInTheDocument();
  });

  it("keeps advanced agent and permission controls collapsed until requested", () => {
    renderLanding();

    expect(screen.getByLabelText("Agent type", { hidden: true })).not.toBeVisible();
    expect(screen.getByLabelText("Permission", { hidden: true })).not.toBeVisible();

    const toggle = screen.getByRole("button", { name: "Advanced options: Agent type and permission" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Agent type")).toBeInTheDocument();
    expect(screen.getByLabelText("Permission")).toBeInTheDocument();
  });

  it("submits the quick-create defaults through the existing create handler", () => {
    const { onCreate } = renderLanding();

    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Owner" } });
    fireEvent.click(screen.getByRole("button", { name: "Create room and start agent" }));

    expect(onCreate).toHaveBeenCalledWith({
      roomName: "CACP AI Room",
      displayName: "Owner",
      agentType: "claude-code",
      permissionLevel: "read_only",
    });
  });

  it("switches to an invite join card when opened from an invite link", () => {
    const { onJoin } = renderLandingWithInviteUrl();

    expect(screen.getByTestId("landing-invite-card")).toBeInTheDocument();
    expect(screen.queryByTestId("landing-create-card")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Join a shared AI room" })).toBeInTheDocument();
    expect(screen.getByText("Invited room: room_123")).toBeInTheDocument();
    expect(screen.queryByLabelText("Invite token")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Guest" } });
    fireEvent.click(screen.getByRole("button", { name: "Join shared room" }));

    expect(onJoin).toHaveBeenCalledWith({
      roomId: "room_123",
      inviteToken: "token_456",
      displayName: "Guest",
    });
  });
});

function renderLandingWithInviteUrl() {
  window.history.pushState({}, "", "/invite?room=room_123&token=token_456");
  return renderLanding();
}
