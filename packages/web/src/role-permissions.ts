import type { RoomSession } from "./api.js";

export interface RoomRolePermissions {
  canManageControls: boolean;
  canUseAiFlowControl: boolean;
  canSendMainInput: boolean;
  canSendOrbitNotes: boolean;
  canManageJoinRequests: boolean;
  canRemoveParticipants: boolean;
  canUpdateRoles: boolean;
}

export function roomPermissionsForRole(role: RoomSession["role"] | undefined): RoomRolePermissions {
  return {
    canManageControls: role === "owner" || role === "admin",
    canUseAiFlowControl: role === "owner",
    canSendMainInput: role === "owner" || role === "admin",
    canSendOrbitNotes: role === "owner" || role === "admin" || role === "member",
    canManageJoinRequests: role === "owner" || role === "admin",
    canRemoveParticipants: role === "owner" || role === "admin",
    canUpdateRoles: role === "owner"
  };
}
