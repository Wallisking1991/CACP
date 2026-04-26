import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("App room copy and layout source", () => {
  const appSource = () => readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const cssSource = () => readFileSync(resolve(process.cwd(), "src/App.css"), "utf8");

  it("keeps the room workspace controls in English without default policy or decisions", () => {
    const source = appSource();

    expect(source).toContain("Clear room");
    expect(source).toContain("Collapse controls");
    expect(source).toContain("AI Flow Control");
    expect(source).not.toContain("Default policy");
    expect(source).not.toContain("Current Decision");
    expect(source).not.toContain("Decision History");
    expect(source).not.toContain("No active decision.");
  });

  it("labels the room header as an AI collaboration platform demo instead of a decision platform", () => {
    const source = appSource();

    expect(source).toContain("AI Collaboration Platform Demo");
    expect(source).toContain("Collaborative AI workspace demo");
    expect(source).not.toContain("Decision Workspace");
  });

  it("does not keep Chinese labels or mojibake from the previous UI", () => {
    const source = appSource();

    expect(source).not.toMatch(/只读|参与者|受限写入|完整权限|房主批准|多数通过|全员一致/);
    expect(source).not.toMatch(/åªè¯»|å—é™å†™å…¥|å®Œæ•´æƒé™|å‚ä¸Žè€…|æˆ¿ä¸»|å¤šæ•°|å…¨å‘˜/);
  });

  it("uses room management and collapsed-control badge APIs without manual question or decision responses", () => {
    const source = appSource();

    expect(source).toContain("clearRoom(");
    expect(source).toContain("badgeChangesForCollapsedControls");
    expect(source).toContain("controlSectionSignatures");
    expect(source).not.toContain("submitQuestionResponse");
    expect(source).not.toContain("cancelDecision");
  });

  it("gives unlabeled chat and active-agent controls accessible names", () => {
    const source = appSource();

    expect(source).toContain('aria-label="Message the room');
    expect(source).toContain('aria-label="Active agent');
  });

  it("keeps the chat workspace fixed height with internally scrolling timeline and collapsed controls", () => {
    const source = cssSource();

    expect(source).toContain("overflow-y: auto");
    expect(source).toContain("height: calc(100vh");
    expect(source).toContain(".workspace-grid.collapsed-controls");
  });

  it("keeps fixed-height responsive layout and visible focus styling", () => {
    const source = cssSource();

    expect(source).toContain(":focus-visible");
    expect(source).not.toContain("body { overflow: auto; }");
    expect(source).not.toContain("height: auto; min-height: 100vh; overflow: visible;");
    expect(source).not.toContain("height: auto; max-height: none;");
  });

  it("uses a premium workspace shell with floating collapsed controls", () => {
    const app = appSource();
    const css = cssSource();

    expect(app).toContain("workspace-backdrop");
    expect(app).toContain("workspace-orb");
    expect(app).toContain("command-center-dock");
    expect(app).toContain("dock-label");
    expect(app).toContain("chat-stage");

    expect(css).toContain(".workspace-backdrop");
    expect(css).toContain(".workspace-orb");
    expect(css).toContain(".command-center-dock");
    expect(css).toContain("position: fixed");
    expect(css).toContain("backdrop-filter: blur(24px)");
    expect(css).toContain("cubic-bezier(0.22, 1, 0.36, 1)");
  });

  it("moves local agent setup into the room creation flow while keeping manual management fallback", () => {
    const source = appSource();

    expect(source).toContain("Local Agent setup");
    expect(source).toContain("Create room and start agent");
    expect(source).toContain("createRoomWithLocalAgent");
    expect(source).toContain("Starting the local agent failed");
    expect(source).toContain("Agent Status");
    expect(source).toContain("Manage Agent");
    expect(source).toContain("Start local agent");
    expect(source).toContain("Show manual command");
    expect(source).toContain("Local launch started");
  });

  it("explains that slow CLI responses have an automatic timeout", () => {
    const source = appSource();

    expect(source).toContain("It will fail automatically if the CLI hangs.");
  });

  it("offers host-controlled AI answer collection controls", () => {
    const source = appSource();

    expect(source).toContain("Start collecting answers");
    expect(source).toContain("Submit collected answers");
    expect(source).toContain("Cancel collection");
    expect(source).toContain("Queued for AI");
    expect(source).toContain("AI is paused");
  });
});
