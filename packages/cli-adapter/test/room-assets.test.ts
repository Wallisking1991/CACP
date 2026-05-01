import { describe, expect, it } from "vitest";
import { roomAssetDirectory, slugifyRoomTitle } from "../src/connector/room-assets.js";

describe("slugifyRoomTitle", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugifyRoomTitle("My Cool Room")).toBe("my-cool-room");
  });

  it("removes non-alphanumeric characters except hyphens", () => {
    expect(slugifyRoomTitle("Room @ #1!")).toBe("room-1");
  });

  it("collapses multiple hyphens", () => {
    expect(slugifyRoomTitle("Room   Name")).toBe("room-name");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugifyRoomTitle("!Room!")).toBe("room");
  });
});

describe("roomAssetDirectory", () => {
  it("returns a path inside .cacp/rooms with date prefix", () => {
    const dir = roomAssetDirectory({
      baseDir: "/home/user/projects",
      roomId: "room_abc",
      roomName: "Test Room"
    });
    expect(dir).toMatch(/\.cacp\/rooms\/\d{4}-\d{2}-\d{2}-test-room-room_abc$/);
  });

  it("includes exports subdirectory when requested", () => {
    const dir = roomAssetDirectory({
      baseDir: "/home/user/projects",
      roomId: "room_abc",
      roomName: "Test Room",
      includeExports: true
    });
    expect(dir).toMatch(/\.cacp\/rooms\/\d{4}-\d{2}-\d{2}-test-room-room_abc\/exports$/);
  });
});
