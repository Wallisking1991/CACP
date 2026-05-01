import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    window.localStorage.clear();
    window.history.pushState({}, "", "/");
    originalFetch = global.fetch;
    global.fetch = vi.fn() as unknown as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
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

  it("removes collapsed advanced controls from the accessibility tree and tab order", () => {
    renderLanding();

    const panel = screen.getByLabelText("Agent type", { hidden: true }).closest("#landing-advanced-options") as HTMLElement;
    expect(panel).toHaveAttribute("aria-hidden", "true");
    expect(panel).toHaveAttribute("inert");

    const toggle = screen.getByRole("button", { name: "Advanced options: Agent type and permission" });
    fireEvent.click(toggle);

    expect(panel).not.toHaveAttribute("aria-hidden");
    expect(panel).not.toHaveAttribute("inert");
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

  it("switches to an invite join card when opened from an invite link", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ valid: true })
    });

    const { onJoin } = renderLandingWithInviteUrl();

    expect(screen.getByTestId("landing-invite-card")).toBeInTheDocument();
    expect(screen.queryByTestId("landing-create-card")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Join a shared AI room" })).toBeInTheDocument();
    expect(screen.getByText("Invited room: room_123")).toBeInTheDocument();
    expect(screen.queryByLabelText("Invite token")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Guest" } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Join shared room" })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Join shared room" }));

    expect(onJoin).toHaveBeenCalledWith({
      roomId: "room_123",
      inviteToken: "token_456",
      displayName: "Guest",
    });
  });

  it("disables join button and shows error for expired invite", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ valid: false, reason: "expired" })
    });

    renderLandingWithInviteUrl();

    await waitFor(() => {
      expect(screen.getByTestId("landing-invite-error")).toBeInTheDocument();
    });

    expect(screen.getByTestId("landing-invite-error")).toHaveTextContent(/expired/i);
    expect(screen.getByRole("button", { name: "Join shared room" })).toBeDisabled();
  });

  it("disables join button and shows error for revoked invite", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ valid: false, reason: "revoked" })
    });

    renderLandingWithInviteUrl();

    await waitFor(() => {
      expect(screen.getByTestId("landing-invite-error")).toBeInTheDocument();
    });

    expect(screen.getByTestId("landing-invite-error")).toHaveTextContent(/revoked/i);
    expect(screen.getByRole("button", { name: "Join shared room" })).toBeDisabled();
  });

  it("disables join button and shows error when invite limit is reached", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ valid: false, reason: "limit_reached" })
    });

    renderLandingWithInviteUrl();

    await waitFor(() => {
      expect(screen.getByTestId("landing-invite-error")).toBeInTheDocument();
    });

    expect(screen.getByTestId("landing-invite-error")).toHaveTextContent(/limit/i);
    expect(screen.getByRole("button", { name: "Join shared room" })).toBeDisabled();
  });
});

function renderLandingWithInviteUrl() {
  window.history.pushState({}, "", "/invite?room=room_123&token=token_456");
  return renderLanding();
}
