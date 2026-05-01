import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as {
  scripts?: Record<string, string>;
};

describe("connector bundle script", () => {
  it("preserves import.meta.url for SDKs bundled into the CJS connector", () => {
    const script = packageJson.scripts?.["bundle:connector"] ?? "";

    expect(script).toContain("--banner:js=");
    expect(script).toContain("pathToFileURL(__filename).href");
    expect(script).toContain("--define:import.meta.url=__import_meta_url");
  });
});
