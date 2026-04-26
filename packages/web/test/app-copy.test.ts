import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("App room copy and layout source", () => {
  const appSource = () => readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const cssSource = () => readFileSync(resolve(process.cwd(), "src/App.css"), "utf8");

  it("keeps the room workspace controls and decision copy in English", () => {
    const source = appSource();

    expect(source).toContain("Clear room");
    expect(source).toContain("Collapse controls");
    expect(source).toContain("Current Decision");
    expect(source).toContain("Decision History");
    expect(source).toContain("No active decision.");
  });

  it("does not keep Chinese labels or mojibake from the previous UI", () => {
    const source = appSource();

    expect(source).not.toMatch(/只读|参与者|受限写入|完整权限|房主批准|多数通过|全员一致/);
    expect(source).not.toMatch(/åªè¯»|å—é™å†™å…¥|å®Œæ•´æƒé™|å‚ä¸Žè€…|æˆ¿ä¸»|å¤šæ•°|å…¨å‘˜/);
  });

  it("uses room management and collapsed-control badge APIs without manual question responses", () => {
    const source = appSource();

    expect(source).toContain("clearRoom(");
    expect(source).toContain("cancelDecision(");
    expect(source).toContain("badgeChangesForCollapsedControls");
    expect(source).not.toContain("submitQuestionResponse");
  });

  it("keeps the chat workspace fixed height with internally scrolling timeline and collapsed controls", () => {
    const source = cssSource();

    expect(source).toContain("overflow-y: auto");
    expect(source).toContain("height: calc(100vh");
    expect(source).toContain(".workspace-grid.collapsed-controls");
  });
});
