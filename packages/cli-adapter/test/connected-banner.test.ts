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

    expect(banner).toContain("连接成功 / CONNECTED");
    expect(banner).toContain("请不要关闭此窗口");
    expect(banner).toContain("房主现在可以回到 Web 房间");
    expect(banner).toContain("开启多人协同式 AI 创作");
    expect(banner).toContain("CACP Web Room");
    expect(banner).toContain("Local Agent");
    expect(banner).toContain("D:\\Connector\\rooms\\room_1\\chat.md");
  });

  it("renders a clear transcript failure message without hiding the successful connection", () => {
    const banner = formatConnectedBanner({
      roomId: "room_1",
      chatPath: "D:\\Connector\\rooms\\room_1\\chat.md",
      chatAvailable: false,
      transcriptError: "Unable to write chat transcript: access denied",
      color: false
    });

    expect(banner).toContain("连接成功 / CONNECTED");
    expect(banner).toContain("聊天记录保存失败");
    expect(banner).toContain("access denied");
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
    expect(log.mock.calls[0][0]).toContain("连接成功 / CONNECTED");
  });
});
