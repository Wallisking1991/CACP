import { describe, expect, it } from "vitest";
import { deploymentModeFromEnv, isCloudMode } from "../src/runtime-config.js";

describe("web runtime config", () => {
  it("detects cloud mode", () => {
    expect(deploymentModeFromEnv({ VITE_CACP_DEPLOYMENT_MODE: "cloud" })).toBe("cloud");
    expect(isCloudMode({ VITE_CACP_DEPLOYMENT_MODE: "cloud" })).toBe(true);
  });
  it("defaults to local mode", () => {
    expect(deploymentModeFromEnv({})).toBe("local");
    expect(isCloudMode({})).toBe(false);
  });
});
