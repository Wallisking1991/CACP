import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { MicrophoneCheckPanel } from "../src/components/MicrophoneCheckPanel.js";
import { LangProvider } from "../src/i18n/LangProvider.js";

function fakeStream() {
  const track = {
    stop: vi.fn(),
    getSettings: vi.fn(() => ({ deviceId: "mic-1" })),
  } as unknown as MediaStreamTrack;
  return {
    stream: {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream,
    track,
  };
}

function fakeAudioContext(active = true) {
  const analyser = {
    fftSize: 0,
    frequencyBinCount: 32,
    getByteTimeDomainData: vi.fn((data: Uint8Array) => {
      data.fill(128);
      if (active) data[0] = 220;
    }),
    disconnect: vi.fn(),
  } as unknown as AnalyserNode;
  const source = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as MediaStreamAudioSourceNode;
  const context = {
    createMediaStreamSource: vi.fn(() => source),
    createAnalyser: vi.fn(() => analyser),
    close: vi.fn(async () => {}),
  } as unknown as AudioContext;
  return { context, source, analyser };
}

describe("MicrophoneCheckPanel", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it("checks permission, lists devices, and reports a live input signal", async () => {
    vi.useFakeTimers();
    const { stream, track } = fakeStream();
    const { context } = fakeAudioContext();
    const mediaDevices = {
      getUserMedia: vi.fn(async () => stream),
      enumerateDevices: vi.fn(async () => [
        {
          deviceId: "mic-1",
          groupId: "group-1",
          kind: "audioinput" as const,
          label: "Studio microphone",
          toJSON: () => ({}),
        },
      ]),
    } as unknown as MediaDevices;

    const view = render(
      <LangProvider>
        <MicrophoneCheckPanel
          connection="connected"
          mediaDevices={mediaDevices}
          createAudioContext={() => context}
          onDeviceChange={vi.fn(async () => {})}
        />
      </LangProvider>
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Start microphone check" })
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mediaDevices.getUserMedia).toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(screen.getByText("Microphone is working")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Input device" })).toHaveValue(
      "mic-1"
    );
    expect(
      screen.getByRole("meter", { name: "Microphone input level" })
    ).toHaveAttribute("aria-valuenow", expect.not.stringMatching(/^0$/));

    view.unmount();
    expect(track.stop).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
  });

  it("explains a denied microphone permission", async () => {
    const mediaDevices = {
      getUserMedia: vi.fn(async () => {
        throw new DOMException("Permission denied", "NotAllowedError");
      }),
      enumerateDevices: vi.fn(async () => []),
    } as unknown as MediaDevices;

    render(
      <LangProvider>
        <MicrophoneCheckPanel
          connection="disconnected"
          mediaDevices={mediaDevices}
        />
      </LangProvider>
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Start microphone check" })
    );

    expect(
      await screen.findByText("Microphone permission was denied")
    ).toBeInTheDocument();
  });

  it("reports silence and can play a local three-second test recording", async () => {
    vi.useFakeTimers();
    const { stream } = fakeStream();
    const { context } = fakeAudioContext(false);
    const mediaDevices = {
      getUserMedia: vi.fn(async () => stream),
      enumerateDevices: vi.fn(async () => []),
    } as unknown as MediaDevices;
    class FakeRecorder extends EventTarget {
      state: RecordingState = "inactive";
      mimeType = "audio/webm";
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        const dataEvent = new Event("dataavailable") as BlobEvent;
        Object.defineProperty(dataEvent, "data", {
          value: new Blob(["sample"], { type: this.mimeType }),
        });
        this.dispatchEvent(dataEvent);
        this.dispatchEvent(new Event("stop"));
      }
    }
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:microphone-sample"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });

    const view = render(
      <LangProvider>
        <MicrophoneCheckPanel
          connection="connected"
          mediaDevices={mediaDevices}
          createAudioContext={() => context}
          createMediaRecorder={() =>
            new FakeRecorder() as unknown as MediaRecorder
          }
        />
      </LangProvider>
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Start microphone check" })
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_600);
    });
    expect(
      screen.getByText("No microphone input detected")
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Record a 3-second test sample" })
    );
    expect(
      screen.getByRole("button", { name: "Stop test recording" })
    ).toBeEnabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(
      screen.getByText("Local test recording is ready to play.")
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Local microphone test recording")
    ).toHaveAttribute("src", "blob:microphone-sample");
    view.unmount();
  });

  it("falls back to the default microphone when a saved device disappeared", async () => {
    vi.useFakeTimers();
    const { stream } = fakeStream();
    const { context } = fakeAudioContext();
    const mediaDevices = {
      getUserMedia: vi
        .fn()
        .mockRejectedValueOnce(
          new DOMException("Saved device disappeared", "OverconstrainedError")
        )
        .mockResolvedValueOnce(stream),
      enumerateDevices: vi.fn(async () => []),
    } as unknown as MediaDevices;

    render(
      <LangProvider>
        <MicrophoneCheckPanel
          connection="disconnected"
          preferredDeviceId="missing-microphone"
          mediaDevices={mediaDevices}
          createAudioContext={() => context}
        />
      </LangProvider>
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Start microphone check" })
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Microphone is working")).toBeInTheDocument();
  });

  it("identifies a voice reconnect separately from the local device check", () => {
    render(
      <LangProvider>
        <MicrophoneCheckPanel connection="reconnecting" />
      </LangProvider>
    );

    expect(
      screen.getByText(
        "Voice is reconnecting; the microphone control is temporarily locked."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start microphone check" })
    ).toBeEnabled();
  });

  it("stops a microphone stream that arrives after the panel closes", async () => {
    const { stream, track } = fakeStream();
    let resolveStream: ((stream: MediaStream) => void) | undefined;
    const mediaDevices = {
      getUserMedia: vi.fn(
        async () =>
          await new Promise<MediaStream>((resolve) => {
            resolveStream = resolve;
          })
      ),
      enumerateDevices: vi.fn(async () => []),
    } as unknown as MediaDevices;
    const view = render(
      <LangProvider>
        <MicrophoneCheckPanel
          connection="disconnected"
          mediaDevices={mediaDevices}
        />
      </LangProvider>
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Start microphone check" })
    );
    view.unmount();

    await act(async () => {
      resolveStream?.(stream);
      await Promise.resolve();
    });

    expect(track.stop).toHaveBeenCalled();
    expect(mediaDevices.enumerateDevices).not.toHaveBeenCalled();
  });
});
