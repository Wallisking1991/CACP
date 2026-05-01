import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { openRoomCache, getCachedRoomIds, getRoomEvents, setRoomEvents, clearRoomCache, deleteRoomCache } from "../src/room-cache.js";

describe("room-cache", () => {
  beforeEach(async () => {
    await clearRoomCache();
  });

  afterEach(async () => {
    await clearRoomCache();
  });

  it("stores and retrieves room events", async () => {
    const cache = await openRoomCache();
    const events = [{ event_id: "evt_1", type: "message.created" }];
    await setRoomEvents(cache, "room_1", events);
    const retrieved = await getRoomEvents(cache, "room_1");
    expect(retrieved).toEqual(events);
  });

  it("returns undefined for missing room", async () => {
    const cache = await openRoomCache();
    const retrieved = await getRoomEvents(cache, "missing_room");
    expect(retrieved).toBeUndefined();
  });

  it("lists cached room ids", async () => {
    const cache = await openRoomCache();
    await setRoomEvents(cache, "room_a", []);
    await setRoomEvents(cache, "room_b", []);
    const ids = await getCachedRoomIds(cache);
    expect(ids.sort()).toEqual(["room_a", "room_b"]);
  });

  it("deletes a specific room", async () => {
    const cache = await openRoomCache();
    await setRoomEvents(cache, "room_1", [{ event_id: "evt_1" }]);
    await deleteRoomCache(cache, "room_1");
    const retrieved = await getRoomEvents(cache, "room_1");
    expect(retrieved).toBeUndefined();
  });

  it("clears all rooms", async () => {
    const cache = await openRoomCache();
    await setRoomEvents(cache, "room_1", []);
    await setRoomEvents(cache, "room_2", []);
    await clearRoomCache();
    const ids = await getCachedRoomIds(cache);
    expect(ids).toEqual([]);
  });

  it("overwrites existing events for a room", async () => {
    const cache = await openRoomCache();
    await setRoomEvents(cache, "room_1", [{ event_id: "evt_1" }]);
    await setRoomEvents(cache, "room_1", [{ event_id: "evt_2" }]);
    const retrieved = await getRoomEvents(cache, "room_1");
    expect(retrieved).toEqual([{ event_id: "evt_2" }]);
  });
});
