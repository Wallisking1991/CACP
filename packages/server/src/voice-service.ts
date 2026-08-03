import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
} from "livekit-server-sdk";
import type { ServerConfig } from "./config.js";
import type { StoredParticipant } from "./event-store.js";

export interface VoiceJoinCredentials {
  server_url: string;
  participant_token: string;
  can_publish: boolean;
  expires_in: number;
}

export interface VoiceService {
  createJoinCredentials(
    roomId: string,
    participant: StoredParticipant
  ): Promise<VoiceJoinCredentials>;
  removeParticipant(roomId: string, participantId: string): Promise<void>;
  deleteRoom(roomId: string): Promise<void>;
}

function serviceUrl(clientUrl: string): string {
  const url = new URL(clientUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return url.toString().replace(/\/$/, "");
}

export function createVoiceService(
  config: ServerConfig
): VoiceService | undefined {
  if (!config.livekitUrl || !config.livekitApiKey || !config.livekitApiSecret) {
    return undefined;
  }
  const livekitUrl = config.livekitUrl;
  const livekitApiKey = config.livekitApiKey;
  const livekitApiSecret = config.livekitApiSecret;

  const roomClient = new RoomServiceClient(
    serviceUrl(livekitUrl),
    livekitApiKey,
    livekitApiSecret
  );

  return {
    async createJoinCredentials(roomId, participant) {
      const canPublish = participant.role !== "observer";
      const accessToken = new AccessToken(livekitApiKey, livekitApiSecret, {
        identity: participant.id,
        name: participant.display_name,
        metadata: JSON.stringify({
          cacp_room_id: roomId,
          cacp_role: participant.role,
        }),
        ttl: config.livekitTokenTtlSeconds,
      });
      accessToken.addGrant({
        roomJoin: true,
        room: roomId,
        canPublish,
        canPublishData: false,
        canPublishSources: canPublish ? [TrackSource.MICROPHONE] : undefined,
        canSubscribe: true,
      });
      return {
        server_url: livekitUrl,
        participant_token: await accessToken.toJwt(),
        can_publish: canPublish,
        expires_in: config.livekitTokenTtlSeconds,
      };
    },

    async removeParticipant(roomId, participantId) {
      await roomClient.removeParticipant(roomId, participantId, {
        revokeTokenTs: BigInt(Math.floor(Date.now() / 1_000)),
      });
    },

    async deleteRoom(roomId) {
      await roomClient.deleteRoom(roomId);
    },
  };
}
