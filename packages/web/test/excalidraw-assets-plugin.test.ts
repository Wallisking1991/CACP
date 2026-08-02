// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  EXCALIDRAW_ASSET_PREFIX,
  collectExcalidrawFontAssets,
} from "../excalidraw-assets-plugin.js";

describe("Excalidraw self-hosted assets", () => {
  it("emits the editor fonts from the pinned package under a local path", async () => {
    const assets = await collectExcalidrawFontAssets();
    const fileNames = assets.map((asset) => asset.fileName);

    expect(EXCALIDRAW_ASSET_PREFIX).toBe("/excalidraw-assets/");
    expect(fileNames).toContain(
      "excalidraw-assets/fonts/Excalifont/Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2"
    );
    expect(fileNames).toContain(
      "excalidraw-assets/fonts/Xiaolai/Xiaolai-Regular-09850c4077f3fffe707905872e0e2460.woff2"
    );
    expect(assets.every((asset) => asset.source.byteLength > 0)).toBe(true);
  }, 15_000);
});
