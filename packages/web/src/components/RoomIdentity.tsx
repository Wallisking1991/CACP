import { CopyIcon } from "./RoomIcons.js";

export interface RoomIdentityProps {
  roomName: string;
  roomId: string;
  userDisplayName?: string;
  userRole?: string;
  onCopyRoomId: (roomId: string) => void;
}

function shortRoomId(roomId: string): string {
  if (roomId.length <= 16) return roomId;
  return `${roomId.slice(0, 9)}…${roomId.slice(-5)}`;
}

function roleLabel(role?: string): string {
  if (!role) return "";
  return `${role.charAt(0).toUpperCase()}${role.slice(1)}`;
}

export function RoomIdentity({ roomName, roomId, userDisplayName, userRole, onCopyRoomId }: RoomIdentityProps) {
  const userLine = [userDisplayName, roleLabel(userRole)].filter(Boolean).join(" · ");
  return (
    <div className="room-identity">
      <div>
        <h2>{roomName}</h2>
        {userLine ? <p>{userLine}</p> : null}
      </div>
      <button type="button" className="room-id-chip" onClick={() => onCopyRoomId(roomId)} aria-label="Copy room ID" title={roomId}>
        <span>{shortRoomId(roomId)}</span>
        <CopyIcon />
      </button>
    </div>
  );
}
