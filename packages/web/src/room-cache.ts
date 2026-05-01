const DB_NAME = "cacp-room-cache";
const DB_VERSION = 1;
const STORE_NAME = "rooms";

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "room_id" });
      }
    };
  });
  return dbPromise;
}

export interface CachedRoom {
  room_id: string;
  events: unknown[];
  cached_at: string;
}

export async function openRoomCache(): Promise<IDBDatabase> {
  return openDb();
}

export async function getCachedRoomIds(db: IDBDatabase): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAllKeys();
    request.onsuccess = () => {
      resolve((request.result as string[]).filter((k): k is string => typeof k === "string"));
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getRoomEvents(db: IDBDatabase, roomId: string): Promise<unknown[] | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(roomId);
    request.onsuccess = () => {
      const result = request.result as CachedRoom | undefined;
      resolve(result?.events);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function setRoomEvents(db: IDBDatabase, roomId: string, events: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({ room_id: roomId, events, cached_at: new Date().toISOString() });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function deleteRoomCache(db: IDBDatabase, roomId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(roomId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearRoomCache(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
