import {
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteTrack,
} from "livekit-client";
import type {
  VoiceConnectionState,
  VoiceParticipantState,
  VoiceSession,
  VoiceSessionConnectOptions,
  VoiceSessionSnapshot,
} from "./voice-session.js";

function participantState(
  participant: Participant,
  isLocal: boolean
): VoiceParticipantState {
  const microphone = participant.getTrackPublication(Track.Source.Microphone);
  return {
    identity: participant.identity,
    name: participant.name || participant.identity,
    isLocal,
    isSpeaking: participant.isSpeaking,
    microphoneMuted: !microphone || microphone.isMuted,
  };
}

export class LiveKitVoiceSession implements VoiceSession {
  private readonly room = new Room({
    adaptiveStream: true,
    dynacast: true,
    stopLocalTrackOnUnpublish: true,
  });
  private connection: VoiceConnectionState = "disconnected";
  private audioContainer?: HTMLElement;
  private onChange?: (snapshot: VoiceSessionSnapshot) => void;

  constructor() {
    const emit = () => this.emit();
    this.room
      .on(RoomEvent.ParticipantConnected, emit)
      .on(RoomEvent.ParticipantDisconnected, emit)
      .on(RoomEvent.ActiveSpeakersChanged, emit)
      .on(RoomEvent.TrackMuted, emit)
      .on(RoomEvent.TrackUnmuted, emit)
      .on(RoomEvent.LocalTrackPublished, emit)
      .on(RoomEvent.LocalTrackUnpublished, emit)
      .on(RoomEvent.AudioPlaybackStatusChanged, emit)
      .on(RoomEvent.TrackSubscribed, (track) => {
        this.attachAudio(track);
        this.emit();
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        for (const element of track.detach()) element.remove();
        this.emit();
      })
      .on(RoomEvent.Reconnecting, () => {
        this.connection = "reconnecting";
        this.emit();
      })
      .on(RoomEvent.Reconnected, () => {
        this.connection = "connected";
        this.emit();
      })
      .on(RoomEvent.Disconnected, () => {
        this.connection = "disconnected";
        this.emit();
      });
  }

  async connect(options: VoiceSessionConnectOptions): Promise<void> {
    this.audioContainer = options.audioContainer;
    this.onChange = options.onChange;
    await this.room.connect(options.serverUrl, options.participantToken, {
      autoSubscribe: true,
    });
    this.connection = "connected";
    this.emit();
  }

  async setMicrophoneEnabled(
    enabled: boolean,
    deviceId?: string
  ): Promise<void> {
    await this.room.localParticipant.setMicrophoneEnabled(enabled, {
      deviceId,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    this.emit();
  }

  async setMicrophoneDevice(deviceId: string): Promise<void> {
    await this.room.switchActiveDevice("audioinput", deviceId, true);
    this.emit();
  }

  async startAudio(): Promise<void> {
    await this.room.startAudio();
    this.emit();
  }

  async disconnect(): Promise<void> {
    await this.room.disconnect();
    this.audioContainer?.replaceChildren();
    this.connection = "disconnected";
    this.emit();
    this.onChange = undefined;
  }

  private attachAudio(track: RemoteTrack): void {
    if (track.kind !== Track.Kind.Audio || !this.audioContainer) return;
    const element = track.attach();
    element.autoplay = true;
    element.className = "voice-control__remote-audio";
    this.audioContainer.append(element);
  }

  private emit(): void {
    if (!this.onChange) return;
    const participants = [
      participantState(this.room.localParticipant, true),
      ...Array.from(this.room.remoteParticipants.values()).map((participant) =>
        participantState(participant, false)
      ),
    ].sort((left, right) => {
      if (left.isLocal !== right.isLocal) return left.isLocal ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    const microphone = this.room.localParticipant.getTrackPublication(
      Track.Source.Microphone
    );
    this.onChange({
      connection: this.connection,
      participants,
      microphoneEnabled: Boolean(microphone && !microphone.isMuted),
      playbackBlocked: !this.room.canPlaybackAudio,
    });
  }
}
