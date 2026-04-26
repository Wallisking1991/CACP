import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("index.html", () => {
  it("declares an inline favicon so browser smoke tests do not produce a favicon 404", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

    expect(html).toContain('rel="icon"');
    expect(html).toContain("data:image/svg+xml");
  });
});
