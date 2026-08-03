import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import type { RoomSession } from "../src/api.js";
import { VoiceControl } from "../src/components/VoiceControl.js";
import { LangProvider } from "../src/i18n/LangProvider.js";
import type {
  VoiceSession,
  VoiceSessionConnectOptions,
  VoiceSessionSnapshot,
} from "../src/voice/voice-session.js";

const roomSession: RoomSession = {
  room_id: "room_1",
  token: "participant-secret",
  participant_id: "user_1",
  role: "member",
};

class FakeVoiceSession implements VoiceSession {
  onChange?: (snapshot: VoiceSessionSnapshot) => void;
  microphoneEnabled = false;
  connect = vi.fn(async (options: VoiceSessionConnectOptions) => {
    this.onChange = options.onChange;
    this.emit("connected");
  });
  setMicrophoneEnabled = vi.fn(async (enabled: boolean) => {
    this.microphoneEnabled = enabled;
    this.emit("connected");
  });
  setMicrophoneDevice = vi.fn(async () => {});
  startAudio = vi.fn(async () => {
    this.emit("connected", false);
  });
  disconnect = vi.fn(async () => {});

  emit(
    connection: VoiceSessionSnapshot["connection"],
    playbackBlocked = false
  ) {
    this.onChange?.({
      connection,
      microphoneEnabled: this.microphoneEnabled,
      playbackBlocked,
      participants: [
        {
          identity: "user_1",
          name: "Wei",
          isLocal: true,
          isSpeaking: false,
          microphoneMuted: !this.microphoneEnabled,
        },
      ],
    });
  }
}

function credentialResponse(canPublish: boolean) {
  return new Response(
    JSON.stringify({
      server_url: "wss://rtc.example.com",
      participant_token: "short-lived-token",
      can_publish: canPublish,
      expires_in: 300,
    }),
    { status: 201, headers: { "content-type": "application/json" } }
  );
}

describe("VoiceControl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("joins voice, enables the microphone, toggles mute, and leaves", async () => {
    const fetchMock = vi.fn(async () => credentialResponse(true));
    vi.stubGlobal("fetch", fetchMock);
    const voiceSession = new FakeVoiceSession();
    render(
      <LangProvider>
        <VoiceControl
          session={roomSession}
          loadSession={async () => voiceSession}
        />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Join voice" }));

    expect(await screen.findByText("Wei")).toBeInTheDocument();
    await waitFor(() =>
      expect(voiceSession.setMicrophoneEnabled).toHaveBeenCalledWith(
        true,
        undefined
      )
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/rooms/room_1/voice/token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer participant-secret",
        }),
      })
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Mute microphone" })
    );
    await waitFor(() =>
      expect(voiceSession.setMicrophoneEnabled).toHaveBeenLastCalledWith(
        false,
        undefined
      )
    );
    expect(
      await screen.findByRole("button", { name: "Unmute microphone" })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Leave voice" }));
    await waitFor(() => expect(voiceSession.disconnect).toHaveBeenCalled());
    expect(
      screen.getByRole("button", { name: "Join voice" })
    ).toBeInTheDocument();
  });

  it("clears a transient connection error after voice reconnects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => credentialResponse(true))
    );
    const voiceSession = new FakeVoiceSession();
    render(
      <LangProvider>
        <VoiceControl
          session={roomSession}
          loadSession={async () => voiceSession}
        />
      </LangProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Join voice" }));
    await screen.findByText("Wei");

    act(() => voiceSession.emit("disconnected"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The voice connection was interrupted"
    );

    act(() => voiceSession.emit("connected"));
    expect(screen.getByText("Voice connected")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports an unknown capture failure as a microphone problem", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => credentialResponse(true))
    );
    const voiceSession = new FakeVoiceSession();
    voiceSession.setMicrophoneEnabled.mockRejectedValueOnce(
      new Error("capture initialization failed")
    );
    render(
      <LangProvider>
        <VoiceControl
          session={roomSession}
          loadSession={async () => voiceSession}
        />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Join voice" }));

    expect(await screen.findByText("Voice connected")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Microphone access failed"
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      "voice connection was interrupted"
    );
  });

  it("falls back to the default input when the saved microphone is gone", async () => {
    localStorage.setItem("cacp.voice.microphone-device", "missing-device");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => credentialResponse(true))
    );
    const voiceSession = new FakeVoiceSession();
    voiceSession.setMicrophoneEnabled
      .mockRejectedValueOnce(
        new DOMException("Saved microphone is gone", "NotFoundError")
      )
      .mockImplementationOnce(async (enabled: boolean) => {
        voiceSession.microphoneEnabled = enabled;
        voiceSession.emit("connected");
      });
    render(
      <LangProvider>
        <VoiceControl
          session={roomSession}
          loadSession={async () => voiceSession}
        />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Join voice" }));

    await waitFor(() =>
      expect(voiceSession.setMicrophoneEnabled).toHaveBeenNthCalledWith(
        2,
        true,
        undefined
      )
    );
    expect(localStorage.getItem("cacp.voice.microphone-device")).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps observer sessions listen-only without requesting a microphone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => credentialResponse(false))
    );
    const voiceSession = new FakeVoiceSession();
    render(
      <LangProvider>
        <VoiceControl
          session={{ ...roomSession, role: "observer" }}
          loadSession={async () => voiceSession}
        />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Join voice" }));

    expect(
      await screen.findByText(/listen-only voice access/i)
    ).toBeInTheDocument();
    expect(voiceSession.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Mute microphone" })
    ).not.toBeInTheDocument();
  });

  it("opens the local microphone check without joining room voice", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <LangProvider>
        <VoiceControl session={roomSession} />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Test microphone" }));

    expect(screen.getByText("Microphone check")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start microphone check" })
    ).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unlocks the microphone control when a device operation stalls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => credentialResponse(true))
    );
    const voiceSession = new FakeVoiceSession();
    render(
      <LangProvider>
        <VoiceControl
          session={roomSession}
          loadSession={async () => voiceSession}
        />
      </LangProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Join voice" }));
    const muteButton = await screen.findByRole("button", {
      name: "Mute microphone",
    });
    voiceSession.setMicrophoneEnabled.mockImplementationOnce(
      async () => await new Promise<void>(() => {})
    );
    vi.useFakeTimers();

    fireEvent.click(muteButton);
    expect(muteButton).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(muteButton).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The microphone did not respond"
    );
  });

  it("announces a configuration error and offers an icon retry action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "voice_unavailable" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          })
      )
    );
    render(
      <LangProvider>
        <VoiceControl
          session={roomSession}
          loadSession={async () => new FakeVoiceSession()}
        />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Join voice" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Voice is not configured"
    );
    expect(
      screen.getAllByRole("button", { name: "Retry voice connection" })
    ).toHaveLength(2);
  });
});
