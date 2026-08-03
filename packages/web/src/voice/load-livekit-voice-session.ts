import type { VoiceSessionLoader } from "./voice-session.js";

export const loadLiveKitVoiceSession: VoiceSessionLoader = async () => {
  const { LiveKitVoiceSession } = await import("./livekit-voice-session.js");
  return new LiveKitVoiceSession();
};
