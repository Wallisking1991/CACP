import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT.js";
import type { VoiceConnectionState } from "../voice/voice-session.js";
import {
  CheckIcon,
  MicrophoneIcon,
  MicrophoneOffIcon,
  RecordIcon,
  StopIcon,
  WaveformIcon,
  XIcon,
} from "./RoomIcons.js";

type CheckStatus =
  | "idle"
  | "requesting"
  | "listening"
  | "good"
  | "noSignal"
  | "denied"
  | "missing"
  | "unsupported"
  | "error";

export interface MicrophoneCheckPanelProps {
  connection: VoiceConnectionState;
  preferredDeviceId?: string;
  onDeviceChange?: (deviceId: string) => Promise<void> | void;
  onClose?: () => void;
  mediaDevices?: MediaDevices;
  createAudioContext?: () => AudioContext;
  createMediaRecorder?: (stream: MediaStream) => MediaRecorder;
}

function statusKey(status: CheckStatus) {
  return `voice.check.${status}` as const;
}

function stopTracks(stream: MediaStream | undefined): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

export function MicrophoneCheckPanel({
  connection,
  preferredDeviceId = "",
  onDeviceChange,
  onClose,
  mediaDevices,
  createAudioContext,
  createMediaRecorder,
}: MicrophoneCheckPanelProps) {
  const t = useT();
  const [status, setStatus] = useState<CheckStatus>("idle");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(preferredDeviceId);
  const [level, setLevel] = useState(0);
  const [running, setRunning] = useState(false);
  const [recording, setRecording] = useState(false);
  const [sampleUrl, setSampleUrl] = useState<string>();
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const contextRef = useRef<AudioContext | undefined>(undefined);
  const sourceRef = useRef<MediaStreamAudioSourceNode | undefined>(undefined);
  const analyserRef = useRef<AnalyserNode | undefined>(undefined);
  const meterTimerRef = useRef<number | undefined>(undefined);
  const noSignalTimerRef = useRef<number | undefined>(undefined);
  const recordingTimerRef = useRef<number | undefined>(undefined);
  const recorderRef = useRef<MediaRecorder | undefined>(undefined);
  const chunksRef = useRef<Blob[]>([]);
  const sampleUrlRef = useRef<string | undefined>(undefined);
  const operationRef = useRef(0);

  const clearMeasurement = useCallback(() => {
    window.clearInterval(meterTimerRef.current);
    window.clearTimeout(noSignalTimerRef.current);
    meterTimerRef.current = undefined;
    noSignalTimerRef.current = undefined;
    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    sourceRef.current = undefined;
    analyserRef.current = undefined;
    stopTracks(streamRef.current);
    streamRef.current = undefined;
    setRunning(false);
    const context = contextRef.current;
    contextRef.current = undefined;
    if (context) void context.close().catch(() => {});
    setLevel(0);
  }, []);

  const stopRecording = useCallback(() => {
    window.clearTimeout(recordingTimerRef.current);
    recordingTimerRef.current = undefined;
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  const stopCheck = useCallback(() => {
    operationRef.current += 1;
    stopRecording();
    clearMeasurement();
    setRecording(false);
    setStatus("idle");
  }, [clearMeasurement, stopRecording]);

  useEffect(() => {
    sampleUrlRef.current = sampleUrl;
  }, [sampleUrl]);

  useEffect(() => {
    return () => {
      operationRef.current += 1;
      window.clearTimeout(recordingTimerRef.current);
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
      clearMeasurement();
      if (sampleUrlRef.current) URL.revokeObjectURL(sampleUrlRef.current);
    };
  }, [clearMeasurement]);

  const startCheck = useCallback(
    async (requestedDeviceId = selectedDeviceId) => {
      const operation = operationRef.current + 1;
      operationRef.current = operation;
      clearMeasurement();
      const availableMediaDevices =
        mediaDevices ??
        (typeof navigator !== "undefined" ? navigator.mediaDevices : undefined);
      const makeAudioContext =
        createAudioContext ??
        (() => {
          const AudioContextConstructor =
            window.AudioContext ??
            (
              window as typeof window & {
                webkitAudioContext?: typeof AudioContext;
              }
            ).webkitAudioContext;
          if (!AudioContextConstructor)
            throw new Error("AudioContext unavailable");
          return new AudioContextConstructor();
        });
      if (!availableMediaDevices?.getUserMedia) {
        setStatus("unsupported");
        return;
      }
      setStatus("requesting");
      try {
        const baseAudio: MediaTrackConstraints = {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        };
        const requestedAudio: MediaTrackConstraints = { ...baseAudio };
        if (requestedDeviceId) {
          requestedAudio.deviceId = { exact: requestedDeviceId };
        }
        let stream: MediaStream;
        try {
          stream = await availableMediaDevices.getUserMedia({
            audio: requestedAudio,
            video: false,
          });
        } catch (cause) {
          if (
            requestedDeviceId &&
            cause instanceof DOMException &&
            cause.name === "OverconstrainedError"
          ) {
            setSelectedDeviceId("");
            stream = await availableMediaDevices.getUserMedia({
              audio: baseAudio,
              video: false,
            });
          } else {
            throw cause;
          }
        }
        if (operationRef.current !== operation) {
          stopTracks(stream);
          return;
        }
        streamRef.current = stream;
        setRunning(true);
        const audioInputs = (
          await availableMediaDevices.enumerateDevices()
        ).filter((device) => device.kind === "audioinput");
        if (operationRef.current !== operation) {
          stopTracks(stream);
          if (streamRef.current === stream) streamRef.current = undefined;
          return;
        }
        setDevices(audioInputs);
        const activeDeviceId =
          stream.getAudioTracks()[0]?.getSettings().deviceId ??
          requestedDeviceId ??
          audioInputs[0]?.deviceId ??
          "";
        setSelectedDeviceId(activeDeviceId);
        if (activeDeviceId) await onDeviceChange?.(activeDeviceId);

        const context = makeAudioContext();
        contextRef.current = context;
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        sourceRef.current = source;
        analyserRef.current = analyser;
        const samples = new Uint8Array(analyser.fftSize);
        setStatus("listening");
        const measure = () => {
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) {
            const normalized = (sample - 128) / 128;
            sum += normalized * normalized;
          }
          const nextLevel = Math.min(1, Math.sqrt(sum / samples.length) * 4);
          setLevel(nextLevel);
          if (nextLevel >= 0.04) {
            window.clearTimeout(noSignalTimerRef.current);
            setStatus("good");
          }
        };
        measure();
        meterTimerRef.current = window.setInterval(measure, 80);
        noSignalTimerRef.current = window.setTimeout(() => {
          setStatus((current) =>
            current === "listening" ? "noSignal" : current
          );
        }, 2_500);
      } catch (cause) {
        if (operationRef.current !== operation) return;
        clearMeasurement();
        if (cause instanceof DOMException && cause.name === "NotAllowedError") {
          setStatus("denied");
        } else if (
          cause instanceof DOMException &&
          (cause.name === "NotFoundError" ||
            cause.name === "OverconstrainedError")
        ) {
          setStatus("missing");
        } else if (
          cause instanceof Error &&
          cause.message.includes("AudioContext unavailable")
        ) {
          setStatus("unsupported");
        } else {
          setStatus("error");
        }
      }
    },
    [
      clearMeasurement,
      createAudioContext,
      mediaDevices,
      onDeviceChange,
      selectedDeviceId,
    ]
  );

  const chooseDevice = useCallback(
    async (deviceId: string) => {
      setSelectedDeviceId(deviceId);
      if (streamRef.current) {
        await startCheck(deviceId);
      } else {
        await onDeviceChange?.(deviceId);
      }
    },
    [onDeviceChange, startCheck]
  );

  const toggleRecording = useCallback(() => {
    if (recording) {
      stopRecording();
      return;
    }
    const stream = streamRef.current;
    const Recorder =
      createMediaRecorder ??
      (typeof MediaRecorder === "undefined"
        ? undefined
        : (nextStream: MediaStream) => new MediaRecorder(nextStream));
    if (!stream || !Recorder) return;
    if (sampleUrl) URL.revokeObjectURL(sampleUrl);
    setSampleUrl(undefined);
    const recorder = Recorder(stream);
    recorderRef.current = recorder;
    chunksRef.current = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    });
    recorder.addEventListener(
      "stop",
      () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        setSampleUrl(URL.createObjectURL(blob));
        setRecording(false);
        recorderRef.current = undefined;
      },
      { once: true }
    );
    recorder.start();
    setRecording(true);
    recordingTimerRef.current = window.setTimeout(() => stopRecording(), 3_000);
  }, [createMediaRecorder, recording, sampleUrl, stopRecording]);

  const statusTone =
    status === "good"
      ? "good"
      : status === "denied" ||
          status === "missing" ||
          status === "unsupported" ||
          status === "error"
        ? "error"
        : status === "noSignal"
          ? "warning"
          : "neutral";

  return (
    <section
      className="microphone-check"
      aria-labelledby="microphone-check-title"
    >
      <header className="microphone-check__header">
        <div>
          <h2 id="microphone-check-title">{t("voice.check.title")}</h2>
          <p>{t("voice.check.description")}</p>
        </div>
        {onClose && (
          <button
            type="button"
            aria-label={t("voice.check.close")}
            title={t("voice.check.close")}
            onClick={onClose}
          >
            <XIcon />
          </button>
        )}
      </header>

      {connection === "reconnecting" && (
        <p className="microphone-check__connection-note">
          {t("voice.check.reconnecting")}
        </p>
      )}

      <div
        className={`microphone-check__result microphone-check__result--${statusTone}`}
      >
        <span aria-hidden="true">
          {status === "good" ? (
            <CheckIcon />
          ) : statusTone === "error" || statusTone === "warning" ? (
            <MicrophoneOffIcon />
          ) : (
            <WaveformIcon />
          )}
        </span>
        <strong>{t(statusKey(status))}</strong>
      </div>

      {devices.length > 0 && (
        <label className="microphone-check__device">
          <span>{t("voice.check.inputDevice")}</span>
          <select
            aria-label={t("voice.check.inputDevice")}
            value={selectedDeviceId}
            onChange={(event) => void chooseDevice(event.currentTarget.value)}
          >
            {devices.map((device, index) => (
              <option
                key={device.deviceId || `default-${index}`}
                value={device.deviceId}
              >
                {device.label ||
                  `${t("voice.check.defaultDevice")} ${index + 1}`}
              </option>
            ))}
          </select>
          <small>{t("voice.check.deviceApplied")}</small>
        </label>
      )}

      <div className="microphone-check__meter-wrap">
        <div
          className="microphone-check__meter"
          role="meter"
          aria-label={t("voice.check.inputLevel")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(level * 100)}
        >
          <span style={{ transform: `scaleX(${level})` }} />
        </div>
        <span>{t("voice.check.inputLevel")}</span>
      </div>

      <div className="microphone-check__controls">
        <button
          type="button"
          className={running ? "is-active" : undefined}
          aria-label={t(running ? "voice.check.stop" : "voice.check.start")}
          title={t(running ? "voice.check.stop" : "voice.check.start")}
          disabled={status === "requesting"}
          onClick={() => (running ? stopCheck() : void startCheck())}
        >
          {running ? <StopIcon /> : <MicrophoneIcon />}
        </button>
        <button
          type="button"
          className={recording ? "is-recording" : undefined}
          aria-label={t(
            recording ? "voice.check.stopRecording" : "voice.check.record"
          )}
          title={t(
            recording ? "voice.check.stopRecording" : "voice.check.record"
          )}
          disabled={
            !running ||
            (typeof MediaRecorder === "undefined" && !createMediaRecorder)
          }
          onClick={toggleRecording}
        >
          {recording ? <StopIcon /> : <RecordIcon />}
        </button>
      </div>

      {sampleUrl && (
        <div className="microphone-check__sample">
          <span>{t("voice.check.sampleReady")}</span>
          <audio
            controls
            src={sampleUrl}
            aria-label={t("voice.check.sample")}
          />
        </div>
      )}

      <p className="microphone-check__privacy">{t("voice.check.localOnly")}</p>
    </section>
  );
}
