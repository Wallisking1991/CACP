import { describe, expect, it } from "vitest";
import { TokenVerifier } from "livekit-server-sdk";
import type { StoredParticipant } from "../src/event-store.js";
import { createVoiceService } from "../src/voice-service.js";
import { localTestConfig } from "./test-config.js";

function participant(role: StoredParticipant["role"]): StoredParticipant {
  return {
    room_id: "room_1",
    id: "user_1",
    display_name: "Wei",
    type: "human",
    role,
    main_thread_history_access: "allowed",
  };
}

describe("LiveKit voice service", () => {
  const apiKey = "test-api-key";
  const apiSecret = "0123456789abcdef0123456789abcdef";
  const config = localTestConfig({
    livekitUrl: "wss://rtc.example.com",
    livekitApiKey: apiKey,
    livekitApiSecret: apiSecret,
    livekitTokenTtlSeconds: 300,
  });

  it("issues a short-lived microphone-only room grant to members", async () => {
    const service = createVoiceService(config)!;
    const credentials = await service.createJoinCredentials(
      "room_1",
      participant("member")
    );
    const grants = await new TokenVerifier(apiKey, apiSecret).verify(
      credentials.participant_token
    );

    expect(credentials.server_url).toBe("wss://rtc.example.com");
    expect(credentials.can_publish).toBe(true);
    expect(credentials.expires_in).toBe(300);
    expect(grants.sub).toBe("user_1");
    expect(grants.name).toBe("Wei");
    expect(grants.video).toMatchObject({
      room: "room_1",
      roomJoin: true,
      canPublish: true,
      canPublishData: false,
      canSubscribe: true,
      canPublishSources: ["microphone"],
    });
  });

  it("issues subscribe-only grants to observers", async () => {
    const service = createVoiceService(config)!;
    const credentials = await service.createJoinCredentials(
      "room_1",
      participant("observer")
    );
    const grants = await new TokenVerifier(apiKey, apiSecret).verify(
      credentials.participant_token
    );

    expect(credentials.can_publish).toBe(false);
    expect(grants.video).toMatchObject({
      room: "room_1",
      roomJoin: true,
      canPublish: false,
      canPublishData: false,
      canSubscribe: true,
    });
    expect(grants.video?.canPublishSources).toBeUndefined();
  });
});
