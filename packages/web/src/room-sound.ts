export type RoomSoundCue = "message" | "ai-start" | "roundtable" | "agent-online" | "join-request";

export interface RoomSoundController {
  enabled: () => boolean;
  setEnabled: (enabled: boolean) => void;
  volume: () => number;
  setVolume: (volume: number) => void;
  play: (cue: RoomSoundCue) => void;
}

export interface RoomSoundControllerOptions {
  playTone?: (cue: RoomSoundCue, volume: number) => void;
  now?: () => number;
  cooldownMs?: number;
}

const storageKey = "cacp.room.sound.enabled";
const volumeKey = "cacp.room.sound.volume";

export function shouldPlayCueForMessage(input: { actorId: string; currentParticipantId: string }): boolean {
  return input.actorId !== input.currentParticipantId;
}

function storedEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(storageKey) !== "false";
}

function storedVolume(): number {
  if (typeof localStorage === "undefined") return 0.5;
  const raw = localStorage.getItem(volumeKey);
  const parsed = raw ? Number(raw) : 0.5;
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.5;
}

let sharedAudioContext: AudioContext | undefined;

function getAudioContext(): AudioContext | undefined {
  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return undefined;
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContextCtor();
  }
  if (sharedAudioContext.state === "suspended") {
    sharedAudioContext.resume().catch(() => {});
  }
  return sharedAudioContext;
}

if (typeof document !== "undefined") {
  const unlockAudio = () => {
    if (sharedAudioContext?.state === "suspended") {
      sharedAudioContext.resume().catch(() => {});
    }
  };
  document.addEventListener("click", unlockAudio, { once: true });
  document.addEventListener("keydown", unlockAudio, { once: true });
  document.addEventListener("touchstart", unlockAudio, { once: true });
}

function synthTone(cue: RoomSoundCue, volume: number): void {
  const context = getAudioContext();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const frequency = cue === "ai-start" ? 180 : cue === "roundtable" ? 330 : 260;
  oscillator.frequency.value = frequency;
  oscillator.type = "sine";
  const targetGain = 0.035 * volume;
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(targetGain, context.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.18);
}

export function createRoomSoundController({
  playTone = synthTone,
  now = () => Date.now(),
  cooldownMs = 450
}: RoomSoundControllerOptions = {}): RoomSoundController {
  let enabled = storedEnabled();
  let volume = storedVolume();
  const lastPlayedAt = new Map<RoomSoundCue, number>();

  return {
    enabled: () => enabled,
    setEnabled(next: boolean): void {
      enabled = next;
      if (typeof localStorage !== "undefined") localStorage.setItem(storageKey, String(next));
    },
    volume: () => volume,
    setVolume(next: number): void {
      volume = Math.min(1, Math.max(0, next));
      if (typeof localStorage !== "undefined") localStorage.setItem(volumeKey, String(volume));
    },
    play(cue: RoomSoundCue): void {
      if (!enabled) return;
      const current = now();
      const last = lastPlayedAt.get(cue) ?? -Infinity;
      if (current - last < cooldownMs) return;
      lastPlayedAt.set(cue, current);
      try {
        playTone(cue, volume);
      } catch {
        return;
      }
    }
  };
}
