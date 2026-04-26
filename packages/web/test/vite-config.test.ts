// @vitest-environment node
import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config.js";

describe("Vite dev proxy", () => {
  it("proxies room WebSocket streams to the CACP server", () => {
    const roomsProxy = viteConfig.server?.proxy?.["/rooms"];
    expect(roomsProxy).toMatchObject({
      target: "http://127.0.0.1:3737",
      ws: true
    });
  });
});
