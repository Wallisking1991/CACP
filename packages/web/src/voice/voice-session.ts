export type VoiceConnectionState =
  "connected" | "reconnecting" | "disconnected";

export interface VoiceParticipantState {
  identity: string;
  name: string;
  isLocal: boolean;
  isSpeaking: boolean;
  microphoneMuted: boolean;
}

export interface VoiceSessionSnapshot {
  connection: VoiceConnectionState;
  participants: VoiceParticipantState[];
  microphoneEnabled: boolean;
  playbackBlocked: boolean;
}

export interface VoiceSessionConnectOptions {
  serverUrl: string;
  participantToken: string;
  audioContainer: HTMLElement;
  onChange: (snapshot: VoiceSessionSnapshot) => void;
}

export interface VoiceSession {
  connect(options: VoiceSessionConnectOptions): Promise<void>;
  setMicrophoneEnabled(enabled: boolean, deviceId?: string): Promise<void>;
  setMicrophoneDevice(deviceId: string): Promise<void>;
  startAudio(): Promise<void>;
  disconnect(): Promise<void>;
}

export type VoiceSessionLoader = () => Promise<VoiceSession>;
