import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(__dirname, "../src/App.css"), "utf8");

describe("studio room CSS source", () => {
  it("contains the studio shell, avatar rail, floating logo, control center, and message variant selectors", () => {
    for (const selector of [
      ".workspace-header--studio",
      ".room-identity",
      ".role-avatar-rail",
      ".message-own",
      ".message-human-other",
      ".message-ai-card",
      ".message-system-marker",
      ".composer-clear-button",
      ".floating-logo-control",
      ".room-control-center"
    ]) {
      expect(css).toContain(selector);
    }
  });

  it("defines reduced-motion rules for studio animation", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".role-avatar--working");
  });
});
