import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("landing redesign source", () => {
  const cssSource = () => readFileSync(resolve(process.cwd(), "src/App.css"), "utf8");
  const landingSource = () => readFileSync(resolve(process.cwd(), "src/components/Landing.tsx"), "utf8");
  const logoSource = () => readFileSync(resolve(process.cwd(), "src/components/CacpHeroLogo.tsx"), "utf8");

  it("uses the hero showcase and quick-start console classes", () => {
    const source = landingSource();
    expect(source).toContain("landing-hero-grid");
    expect(source).toContain("landing-showcase");
    expect(source).toContain("landing-console");
    expect(source).toContain("landing-advanced-toggle");
    expect(source).not.toContain("tab-bar");
  });

  it("defines a fixed desktop landing shell with internal card overflow", () => {
    const source = cssSource();
    expect(source).toMatch(/\.landing-shell\s*\{[^}]*height:\s*100dvh/s);
    expect(source).toMatch(/\.landing-shell\s*\{[^}]*overflow:\s*hidden/s);
    expect(source).toMatch(/\.landing-hero-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.08fr\)\s*minmax\(340px,\s*440px\)/s);
    expect(source).toMatch(/\.landing-console\s*\{[^}]*overflow-y:\s*auto/s);
  });

  it("defines responsive mobile landing and reduced-motion rules", () => {
    const source = cssSource();
    expect(source).toContain("@media (max-width: 767px)");
    expect(source).toMatch(/@media\s*\(max-width:\s*767px\)[\s\S]*\.landing-hero-grid\s*\{[\s\S]*grid-template-columns:\s*1fr/s);
    expect(source).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.landing-orb/s);
  });

  it("keeps SVG animation classes isolated in the hero logo component", () => {
    const source = logoSource();
    expect(source).toContain("logo-draw");
    expect(source).toContain("logo-core");
    expect(source).toContain("gsap.context");
    expect(source).toContain("prefers-reduced-motion: reduce");
  });
});
