import { describe, expect, it } from "vitest";
import { hasAllowedOrigin, loadServerConfig } from "../src/config.js";

describe("server cloud config", () => {
  it("defaults to local mode", () => {
    const config = loadServerConfig({});
    expect(config.deploymentMode).toBe("local");
    expect(config.enableLocalLaunch).toBe(true);
    expect(config.publicOrigin).toBeUndefined();
    expect(config.maxMessageLength).toBe(4000);
  });

  it("rejects invalid deployment mode", () => {
    expect(() => loadServerConfig({
      CACP_DEPLOYMENT_MODE: "cluod"
    })).toThrow("CACP_DEPLOYMENT_MODE must be local or cloud");
  });
  it("forces local launch off in cloud mode", () => {
    const config = loadServerConfig({
      CACP_DEPLOYMENT_MODE: "cloud",
      CACP_ENABLE_LOCAL_LAUNCH: "true",
      CACP_PUBLIC_ORIGIN: "https://cacp.zuchongai.com",
      CACP_TOKEN_SECRET: "0123456789abcdef0123456789abcdef"
    });
    expect(config.deploymentMode).toBe("cloud");
    expect(config.enableLocalLaunch).toBe(false);
    expect(config.publicOrigin).toBe("https://cacp.zuchongai.com");
  });

  it("rejects unsafe cloud config without token secret", () => {
    expect(() => loadServerConfig({
      CACP_DEPLOYMENT_MODE: "cloud",
      CACP_PUBLIC_ORIGIN: "https://cacp.zuchongai.com"
    })).toThrow("CACP_TOKEN_SECRET is required in cloud mode");
  });

  it("rejects unsafe cloud config with an empty token secret", () => {
    expect(() => loadServerConfig({
      CACP_DEPLOYMENT_MODE: "cloud",
      CACP_PUBLIC_ORIGIN: "https://cacp.zuchongai.com",
      CACP_TOKEN_SECRET: ""
    })).toThrow("CACP_TOKEN_SECRET is required in cloud mode");
  });

  it("rejects unsafe cloud config with a whitespace-only token secret", () => {
    expect(() => loadServerConfig({
      CACP_DEPLOYMENT_MODE: "cloud",
      CACP_PUBLIC_ORIGIN: "https://cacp.zuchongai.com",
      CACP_TOKEN_SECRET: "   "
    })).toThrow("CACP_TOKEN_SECRET is required in cloud mode");
  });

  it("rejects unsafe cloud config with a too-short token secret", () => {
    expect(() => loadServerConfig({
      CACP_DEPLOYMENT_MODE: "cloud",
      CACP_PUBLIC_ORIGIN: "https://cacp.zuchongai.com",
      CACP_TOKEN_SECRET: "short-secret"
    })).toThrow("CACP_TOKEN_SECRET must be at least 32 characters in cloud mode");
  });
  it("checks allowed websocket origins", () => {
    const config = loadServerConfig({
      CACP_DEPLOYMENT_MODE: "cloud",
      CACP_PUBLIC_ORIGIN: "https://cacp.zuchongai.com",
      CACP_TOKEN_SECRET: "0123456789abcdef0123456789abcdef"
    });
    expect(hasAllowedOrigin(config, "https://cacp.zuchongai.com")).toBe(true);
    expect(hasAllowedOrigin(config, "https://evil.example")).toBe(false);
    expect(hasAllowedOrigin(loadServerConfig({}), undefined)).toBe(true);
  });
});
