export type RoomSoundCue = "message" | "ai-start" | "roundtable" | "agent-online" | "join-request";

export interface RoomSoundController {
  enabled: () => boolean;
  setEnabled: (enabled: boolean) => void;
  play: (cue: RoomSoundCue) => void;
}

export interface RoomSoundControllerOptions {
  playTone?: (cue: RoomSoundCue) => void;
  now?: () => number;
  cooldownMs?: number;
}

const storageKey = "cacp.room.sound.enabled";

export function shouldPlayCueForMessage(input: { actorId: string; currentParticipantId: string }): boolean {
  return input.actorId !== input.currentParticipantId;
}

function storedEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(storageKey) !== "false";
}

function synthTone(cue: RoomSoundCue): void {
  const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;
  const context = new AudioContextCtor();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const frequency = cue === "ai-start" ? 180 : cue === "roundtable" ? 330 : 260;
  oscillator.frequency.value = frequency;
  oscillator.type = "sine";
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.035, context.currentTime + 0.01);
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
  const lastPlayedAt = new Map<RoomSoundCue, number>();

  return {
    enabled: () => enabled,
    setEnabled(next: boolean): void {
      enabled = next;
      if (typeof localStorage !== "undefined") localStorage.setItem(storageKey, String(next));
    },
    play(cue: RoomSoundCue): void {
      if (!enabled) return;
      const current = now();
      const last = lastPlayedAt.get(cue) ?? -Infinity;
      if (current - last < cooldownMs) return;
      lastPlayedAt.set(cue, current);
      try {
        playTone(cue);
      } catch {
        return;
      }
    }
  };
}
