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
      ".composer-send-floating",
      ".room-control-center"
    ]) {
      expect(css).toContain(selector);
    }
  });

  it("defines reduced-motion rules for studio animation", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".role-avatar--working");
  });

  it("defines an in-grid Orbit side panel layout instead of an overlay sibling", () => {
    expect(css).toMatch(
      /\.workspace-grid--with-orbit\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(320px,\s*clamp\(360px,\s*20vw,\s*480px\)/s
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*767px\)[\s\S]*\.workspace-grid--with-orbit\s*\{[\s\S]*grid-template-columns:\s*1fr/s
    );
  });

  it("workspace-shell has no max-width to use full screen on large monitors", () => {
    expect(css).not.toMatch(/\.workspace-shell\s*\{[^}]*max-width:/s);
    expect(css).toMatch(/\.workspace-shell\s*\{[^}]*width:\s*calc\(/s);
    expect(css).toMatch(/\.workspace-shell\s*\{[^}]*margin:\s*0\s+auto/s);
  });

  it("workspace-shell background has no grid lines, keeps glow and base color", () => {
    expect(css).not.toMatch(/\.workspace-shell::before\s*\{[^}]*linear-gradient\([^)]*rgba\(194,\s*65,\s*12,\s*0\.18\)/s);
    expect(css).not.toMatch(/\.workspace-shell::before\s*\{[^}]*background-size:/s);
    expect(css).toMatch(/radial-gradient\(circle at 22% 18%/);
    expect(css).toMatch(/var\(--bg\)/);
  });

  it("defines fullscreen agent ripple overlay with fixed positioning", () => {
    expect(css).toMatch(/\.agent-ripple-overlay\s*\{[^}]*position:\s*fixed/s);
    expect(css).toMatch(/\.agent-ripple-overlay\s*\{[^}]*inset:\s*0/s);
    expect(css).toMatch(/\.agent-ripple-overlay\s*\{[^}]*z-index:/s);
    expect(css).toMatch(/\.agent-ripple-overlay\s*\{[^}]*pointer-events:\s*none/s);
  });

  it("defines agent wave layers and ripples using CSS variable for color", () => {
    expect(css).toContain(".agent-wave-layer");
    expect(css).toContain(".agent-ripple");
    expect(css).toMatch(/var\(--agent-color\)/);
  });
});
