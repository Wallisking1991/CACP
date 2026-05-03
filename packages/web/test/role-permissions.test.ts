import { describe, expect, it } from "vitest";
import { roomPermissionsForRole } from "../src/role-permissions.js";

describe("room role permissions", () => {
  it("gives owner full permissions", () => {
    expect(roomPermissionsForRole("owner")).toEqual({
      canManageControls: true,
      canUseAiFlowControl: true,
      canSendMainInput: true,
      canSendOrbitNotes: true,
      canManageJoinRequests: true,
      canRemoveParticipants: true,
      canUpdateRoles: true
    });
  });

  it("gives admin almost-full permissions except AI flow control and role updates", () => {
    expect(roomPermissionsForRole("admin")).toEqual({
      canManageControls: true,
      canUseAiFlowControl: false,
      canSendMainInput: true,
      canSendOrbitNotes: true,
      canManageJoinRequests: true,
      canRemoveParticipants: true,
      canUpdateRoles: false
    });
  });

  it("lets members send orbit notes only", () => {
    expect(roomPermissionsForRole("member")).toEqual({
      canManageControls: false,
      canUseAiFlowControl: false,
      canSendMainInput: false,
      canSendOrbitNotes: true,
      canManageJoinRequests: false,
      canRemoveParticipants: false,
      canUpdateRoles: false
    });
  });

  it("makes observers read-only", () => {
    expect(roomPermissionsForRole("observer")).toEqual({
      canManageControls: false,
      canUseAiFlowControl: false,
      canSendMainInput: false,
      canSendOrbitNotes: false,
      canManageJoinRequests: false,
      canRemoveParticipants: false,
      canUpdateRoles: false
    });
  });
});
