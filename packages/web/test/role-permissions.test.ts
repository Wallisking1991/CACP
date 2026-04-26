import { describe, expect, it } from "vitest";
import { roomPermissionsForRole } from "../src/role-permissions.js";

describe("room role permissions", () => {
  it("allows owners to manage controls, send messages, and use AI Flow Control", () => {
    expect(roomPermissionsForRole("owner")).toEqual({
      canManageControls: true,
      canUseAiFlowControl: true,
      canSendMessages: true
    });
  });

  it("keeps admins as control managers but reserves AI Flow Control for owners", () => {
    expect(roomPermissionsForRole("admin")).toEqual({
      canManageControls: true,
      canUseAiFlowControl: false,
      canSendMessages: true
    });
  });

  it("lets members chat but not change control options", () => {
    expect(roomPermissionsForRole("member")).toEqual({
      canManageControls: false,
      canUseAiFlowControl: false,
      canSendMessages: true
    });
  });

  it("makes observers read-only", () => {
    expect(roomPermissionsForRole("observer")).toEqual({
      canManageControls: false,
      canUseAiFlowControl: false,
      canSendMessages: false
    });
  });
});
