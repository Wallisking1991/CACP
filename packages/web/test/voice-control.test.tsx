import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      expect(voiceSession.setMicrophoneEnabled).toHaveBeenCalledWith(true)
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
      expect(voiceSession.setMicrophoneEnabled).toHaveBeenLastCalledWith(false)
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
