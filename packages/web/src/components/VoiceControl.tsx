import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomSession } from "../api.js";
import { createVoiceJoinCredentials } from "../api.js";
import { useT } from "../i18n/useT.js";
import { loadLiveKitVoiceSession } from "../voice/load-livekit-voice-session.js";
import type {
  VoiceSession,
  VoiceSessionLoader,
  VoiceSessionSnapshot,
} from "../voice/voice-session.js";
import { Popover } from "./Popover.js";
import {
  HeadphonesIcon,
  MicrophoneIcon,
  MicrophoneOffIcon,
  PhoneOffIcon,
  RefreshIcon,
  SoundIcon,
} from "./RoomIcons.js";

type VoiceUiState =
  "idle" | "connecting" | "connected" | "reconnecting" | "error";

const EMPTY_SNAPSHOT: VoiceSessionSnapshot = {
  connection: "disconnected",
  participants: [],
  microphoneEnabled: false,
  playbackBlocked: false,
};

function errorKey(
  cause: unknown
):
  "voice.errorUnavailable" | "voice.errorMicrophone" | "voice.errorConnection" {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.includes("voice_unavailable")) return "voice.errorUnavailable";
  if (
    message.includes("NotAllowedError") ||
    message.includes("Permission denied") ||
    message.includes("Requested device not found")
  ) {
    return "voice.errorMicrophone";
  }
  return "voice.errorConnection";
}

function initials(name: string): string {
  return Array.from(name.trim()).slice(0, 2).join("").toUpperCase();
}

export interface VoiceControlProps {
  session: RoomSession;
  loadSession?: VoiceSessionLoader;
}

export function VoiceControl({
  session,
  loadSession = loadLiveKitVoiceSession,
}: VoiceControlProps) {
  const t = useT();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const audioContainerRef = useRef<HTMLDivElement>(null);
  const voiceSessionRef = useRef<VoiceSession | undefined>(undefined);
  const operationRef = useRef(0);
  const [state, setState] = useState<VoiceUiState>("idle");
  const [snapshot, setSnapshot] =
    useState<VoiceSessionSnapshot>(EMPTY_SNAPSHOT);
  const [canPublish, setCanPublish] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [error, setError] = useState<
    "voice.errorUnavailable" | "voice.errorMicrophone" | "voice.errorConnection"
  >();

  const handleSnapshot = useCallback(
    (voiceSession: VoiceSession, next: VoiceSessionSnapshot) => {
      if (voiceSessionRef.current !== voiceSession) return;
      setSnapshot(next);
      if (next.connection === "connected") setState("connected");
      if (next.connection === "reconnecting") setState("reconnecting");
      if (next.connection === "disconnected") {
        voiceSessionRef.current = undefined;
        setState("error");
        setError("voice.errorConnection");
        setPanelOpen(true);
      }
    },
    []
  );

  const leave = useCallback(async () => {
    operationRef.current += 1;
    const current = voiceSessionRef.current;
    voiceSessionRef.current = undefined;
    setControlBusy(false);
    setPanelOpen(false);
    setState("idle");
    setSnapshot(EMPTY_SNAPSHOT);
    setCanPublish(false);
    setError(undefined);
    if (current) await current.disconnect().catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      operationRef.current += 1;
      const current = voiceSessionRef.current;
      voiceSessionRef.current = undefined;
      if (current) void current.disconnect().catch(() => {});
    };
  }, [session.room_id]);

  const join = useCallback(async () => {
    if (state === "connecting") return;
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    setState("connecting");
    setPanelOpen(true);
    setError(undefined);
    setSnapshot(EMPTY_SNAPSHOT);
    let nextSession: VoiceSession | undefined;
    try {
      const credentials = await createVoiceJoinCredentials(session);
      if (operationRef.current !== operation) return;
      nextSession = await loadSession();
      if (operationRef.current !== operation) {
        await nextSession.disconnect().catch(() => {});
        return;
      }
      if (!audioContainerRef.current) {
        throw new Error("voice audio container unavailable");
      }
      voiceSessionRef.current = nextSession;
      setCanPublish(credentials.can_publish);
      await nextSession.connect({
        serverUrl: credentials.server_url,
        participantToken: credentials.participant_token,
        audioContainer: audioContainerRef.current,
        onChange: (nextSnapshot) => handleSnapshot(nextSession!, nextSnapshot),
      });
      if (operationRef.current !== operation) {
        await nextSession.disconnect().catch(() => {});
        return;
      }
      setState("connected");
      if (credentials.can_publish) {
        try {
          await nextSession.setMicrophoneEnabled(true);
        } catch (cause) {
          setError(errorKey(cause));
        }
      }
    } catch (cause) {
      if (voiceSessionRef.current === nextSession) {
        voiceSessionRef.current = undefined;
      }
      if (nextSession) await nextSession.disconnect().catch(() => {});
      if (operationRef.current !== operation) return;
      setState("error");
      setError(errorKey(cause));
      setPanelOpen(true);
    }
  }, [handleSnapshot, loadSession, session, state]);

  const toggleMicrophone = useCallback(async () => {
    const current = voiceSessionRef.current;
    if (!current || !canPublish || controlBusy) return;
    setControlBusy(true);
    setError(undefined);
    try {
      await current.setMicrophoneEnabled(!snapshot.microphoneEnabled);
    } catch (cause) {
      setError(errorKey(cause));
    } finally {
      setControlBusy(false);
    }
  }, [canPublish, controlBusy, snapshot.microphoneEnabled]);

  const enablePlayback = useCallback(async () => {
    const current = voiceSessionRef.current;
    if (!current || controlBusy) return;
    setControlBusy(true);
    try {
      await current.startAudio();
    } catch (cause) {
      setError(errorKey(cause));
    } finally {
      setControlBusy(false);
    }
  }, [controlBusy]);

  const connected = state === "connected" || state === "reconnecting";
  const triggerLabel =
    state === "connecting"
      ? t("voice.connecting")
      : connected
        ? t("voice.openControls")
        : state === "error"
          ? t("voice.retry")
          : t("voice.join");

  return (
    <div className="voice-control">
      <button
        ref={triggerRef}
        type="button"
        className={`voice-control__trigger voice-control__trigger--${state}`}
        aria-label={triggerLabel}
        aria-expanded={connected ? panelOpen : undefined}
        aria-pressed={connected}
        title={triggerLabel}
        disabled={state === "connecting"}
        onClick={() => {
          if (connected) setPanelOpen((current) => !current);
          else void join();
        }}
      >
        <HeadphonesIcon />
        {connected && snapshot.participants.length > 0 && (
          <span
            className="voice-control__badge"
            aria-label={t("voice.participantCount", {
              count: snapshot.participants.length,
            })}
          >
            {snapshot.participants.length}
          </span>
        )}
        {state === "connecting" && (
          <span className="voice-control__connecting-ring" aria-hidden="true" />
        )}
      </button>

      <Popover
        triggerRef={triggerRef}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
      >
        <section className="voice-panel" aria-labelledby="voice-panel-title">
          <header className="voice-panel__header">
            <div>
              <h2 id="voice-panel-title">{t("voice.title")}</h2>
              <p>
                {state === "connecting"
                  ? t("voice.connecting")
                  : state === "reconnecting"
                    ? t("voice.reconnecting")
                    : connected
                      ? t("voice.connected")
                      : t("voice.disconnected")}
              </p>
            </div>
            <span
              className={`voice-panel__status voice-panel__status--${state}`}
              aria-hidden="true"
            />
          </header>

          {error && (
            <div className="voice-panel__error" role="alert">
              <span>{t(error)}</span>
              {!connected && state !== "connecting" && (
                <button
                  type="button"
                  aria-label={t("voice.retry")}
                  title={t("voice.retry")}
                  onClick={() => void join()}
                >
                  <RefreshIcon />
                </button>
              )}
            </div>
          )}

          {connected && (
            <>
              <ul
                className="voice-panel__participants"
                aria-label={t("voice.participants")}
              >
                {snapshot.participants.map((participant) => (
                  <li
                    key={participant.identity}
                    className={
                      participant.isSpeaking ? "is-speaking" : undefined
                    }
                  >
                    <span className="voice-panel__avatar" aria-hidden="true">
                      {initials(participant.name)}
                    </span>
                    <span className="voice-panel__participant-name">
                      {participant.name}
                      {participant.isLocal && <small>{t("voice.you")}</small>}
                    </span>
                    <span
                      className="voice-panel__participant-state"
                      title={
                        participant.microphoneMuted
                          ? t("voice.muted")
                          : t("voice.unmuted")
                      }
                    >
                      {participant.microphoneMuted ? (
                        <MicrophoneOffIcon />
                      ) : (
                        <MicrophoneIcon />
                      )}
                    </span>
                  </li>
                ))}
              </ul>

              {!canPublish && (
                <p className="voice-panel__listen-only">
                  {t("voice.listenOnly")}
                </p>
              )}

              <footer className="voice-panel__controls">
                {snapshot.playbackBlocked && (
                  <button
                    type="button"
                    aria-label={t("voice.enableAudio")}
                    title={t("voice.enableAudio")}
                    disabled={controlBusy}
                    onClick={() => void enablePlayback()}
                  >
                    <SoundIcon />
                  </button>
                )}
                {canPublish && (
                  <button
                    type="button"
                    className={
                      snapshot.microphoneEnabled
                        ? "voice-panel__mic"
                        : "voice-panel__mic voice-panel__mic--muted"
                    }
                    aria-label={
                      snapshot.microphoneEnabled
                        ? t("voice.mute")
                        : t("voice.unmute")
                    }
                    title={
                      snapshot.microphoneEnabled
                        ? t("voice.mute")
                        : t("voice.unmute")
                    }
                    aria-pressed={!snapshot.microphoneEnabled}
                    disabled={controlBusy || state === "reconnecting"}
                    onClick={() => void toggleMicrophone()}
                  >
                    {snapshot.microphoneEnabled ? (
                      <MicrophoneIcon />
                    ) : (
                      <MicrophoneOffIcon />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  className="voice-panel__leave"
                  aria-label={t("voice.leave")}
                  title={t("voice.leave")}
                  onClick={() => void leave()}
                >
                  <PhoneOffIcon />
                </button>
              </footer>
            </>
          )}

          <div ref={audioContainerRef} hidden aria-hidden="true" />
        </section>
      </Popover>
    </div>
  );
}
