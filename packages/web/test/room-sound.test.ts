import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoomSoundController, shouldPlayCueForMessage } from "../src/room-sound.js";

describe("room sound cues", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults sound cues on and persists mute preference", () => {
    const controller = createRoomSoundController({ playTone: vi.fn(), now: () => 1000 });
    expect(controller.enabled()).toBe(true);
    controller.setEnabled(false);
    expect(controller.enabled()).toBe(false);
    expect(localStorage.getItem("cacp.room.sound.enabled")).toBe("false");
  });

  it("suppresses own-message cues and plays other-message cues", () => {
    expect(shouldPlayCueForMessage({ actorId: "user_1", currentParticipantId: "user_1" })).toBe(false);
    expect(shouldPlayCueForMessage({ actorId: "user_2", currentParticipantId: "user_1" })).toBe(true);
  });

  it("uses cooldown to avoid noisy cue bursts", () => {
    let now = 1000;
    const playTone = vi.fn();
    const controller = createRoomSoundController({ playTone, now: () => now, cooldownMs: 500 });

    controller.play("message");
    controller.play("message");
    now = 1501;
    controller.play("message");

    expect(playTone).toHaveBeenCalledTimes(2);
  });
});
