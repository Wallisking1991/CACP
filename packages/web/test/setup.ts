import "@testing-library/jest-dom/vitest";
import { TextEncoder, TextDecoder } from "util";

// jsdom's TextEncoder returns a Uint8Array from a different realm,
// breaking esbuild's invariant check. Replace with Node-native ones.
if (typeof globalThis.TextEncoder !== "undefined") {
  globalThis.TextEncoder = TextEncoder as unknown as typeof globalThis.TextEncoder;
}
if (typeof globalThis.TextDecoder !== "undefined") {
  globalThis.TextDecoder = TextDecoder as unknown as typeof globalThis.TextDecoder;
}
