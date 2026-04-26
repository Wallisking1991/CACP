import type { RoomSession } from "./api.js";

export interface RoomRolePermissions {
  canManageControls: boolean;
  canUseAiFlowControl: boolean;
  canSendMessages: boolean;
}

export function roomPermissionsForRole(role: RoomSession["role"] | undefined): RoomRolePermissions {
  return {
    canManageControls: role === "owner" || role === "admin",
    canUseAiFlowControl: role === "owner",
    canSendMessages: role === "owner" || role === "admin" || role === "member"
  };
}
