import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("repository ignore rules", () => {
  it("ignores local CACP room assets", () => {
    const gitignore = readFileSync(resolve(process.cwd(), "..", "..", ".gitignore"), "utf8");
    expect(gitignore.split(/\r?\n/)).toContain(".cacp/");
  });
});
