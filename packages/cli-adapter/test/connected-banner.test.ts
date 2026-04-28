import { describe, expect, it, vi } from "vitest";
import { formatConnectedBanner, printConnectedBanner } from "../src/connected-banner.js";

describe("connected banner", () => {
  it("renders the success message, warning, web-room prompt, diagram, and chat path", () => {
    const banner = formatConnectedBanner({
      roomId: "room_1",
      chatPath: "D:\\Connector\\rooms\\room_1\\chat.md",
      chatAvailable: true,
      color: false
    });

    expect(banner).toContain("CONNECTED SUCCESSFULLY");
    expect(banner).toContain("Do not close this window");
    expect(banner).toContain("The room owner can now return to the CACP Web Room");
    expect(banner).toContain("Start collaborative AI creation");
    expect(banner).toContain("CACP Web Room");
    expect(banner).toContain("Local Agent");
    expect(banner).toContain("Local chat transcript chat.md");
    expect(banner).toContain("D:\\Connector\\rooms\\room_1\\chat.md");
    expect(banner).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it("renders a clear transcript failure message without hiding the successful connection", () => {
    const banner = formatConnectedBanner({
      roomId: "room_1",
      chatPath: "D:\\Connector\\rooms\\room_1\\chat.md",
      chatAvailable: false,
      transcriptError: "Unable to write chat transcript: access denied",
      color: false
    });

    expect(banner).toContain("CONNECTED SUCCESSFULLY");
    expect(banner).toContain("Unable to save the chat transcript");
    expect(banner).toContain("access denied");
    expect(banner).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it("prints the banner through an injectable logger", () => {
    const log = vi.fn();
    printConnectedBanner({
      roomId: "room_1",
      chatPath: "D:\\Connector\\rooms\\room_1\\chat.md",
      chatAvailable: true,
      color: false
    }, log);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("CONNECTED SUCCESSFULLY");
  });
});
