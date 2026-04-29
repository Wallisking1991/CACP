import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("App room copy and layout source", () => {
  const appSource = () => readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const workspaceSource = () => readFileSync(resolve(process.cwd(), "src/components/Workspace.tsx"), "utf8");
  const headerSource = () => readFileSync(resolve(process.cwd(), "src/components/Header.tsx"), "utf8");
  const sidebarSource = () => readFileSync(resolve(process.cwd(), "src/components/Sidebar.tsx"), "utf8");
  const threadSource = () => readFileSync(resolve(process.cwd(), "src/components/Thread.tsx"), "utf8");
  const composerSource = () => readFileSync(resolve(process.cwd(), "src/components/Composer.tsx"), "utf8");
  const landingSource = () => readFileSync(resolve(process.cwd(), "src/components/Landing.tsx"), "utf8");
  const i18nSource = () => readFileSync(resolve(process.cwd(), "src/i18n/messages.en.json"), "utf8");
  const cssSource = () => readFileSync(resolve(process.cwd(), "src/App.css"), "utf8");

  const allSource = () =>
    appSource() +
    workspaceSource() +
    headerSource() +
    sidebarSource() +
    threadSource() +
    composerSource() +
    landingSource() +
    i18nSource();

  it("keeps the room workspace controls in English without default policy or decisions", () => {
    const source = allSource();

    expect(source).toContain("Clear room");
    expect(source).not.toContain("Default policy");
    expect(source).not.toContain("Current Decision");
    expect(source).not.toContain("Decision History");
    expect(source).not.toContain("No active decision.");
  });

  it("labels the room header as an AI collaboration platform demo instead of a decision platform", () => {
    const source = allSource();

    expect(source).toContain("Collaborative Agent Communication Protocol");
    expect(source).not.toContain("Decision Workspace");
  });

  it("does not keep Chinese labels or mojibake from the previous UI", () => {
    const source = allSource();

    expect(source).not.toMatch(/只读|参与者|受限写入|完整权限|房主批准|多数通过|全员一致/);
    expect(source).not.toMatch(/åªè¯»|å—é™å†™å…¥|å®Œæ•´æƒé™|å‚ä¸Žè€…|æˆ¿ä¸»|å¤šæ•°|å…¨å‘˜/);
  });

  it("uses room management APIs without manual question or decision responses", () => {
    const source = allSource();

    expect(source).toContain("clearRoom(");
    expect(source).not.toContain("submitQuestionResponse");
    expect(source).not.toContain("cancelDecision");
  });

  it("gives unlabeled chat and active-agent controls accessible names", () => {
    const source = allSource();

    expect(source).toContain('aria-label={t("composer.messageLabel")}');
    expect(source).toContain('aria-label={`Active agent ${activeAgent.name}`}');
  });

  it("keeps the chat workspace fixed height with internally scrolling timeline", () => {
    const source = cssSource();

    expect(source).toContain("overflow-y: auto");
    expect(source).toContain("height: 100dvh");
  });

  it("keeps fixed-height responsive layout and visible focus styling", () => {
    const source = cssSource();

    expect(source).toContain(":focus-visible");
    expect(source).not.toContain("body { overflow: auto; }");
    expect(source).not.toContain("height: auto; min-height: 100vh; overflow: visible;");
    expect(source).not.toContain("height: auto; max-height: none;");
  });


  it("keeps Claude session history and transcript preview independently scrollable", () => {
    const source = cssSource();

    expect(source).toMatch(/\.claude-session-list\s*\{[^}]*max-height:[^;}]+;[^}]*overflow-y:\s*auto/s);
    expect(source).toMatch(/\.claude-session-preview-messages\s*\{[^}]*overflow-y:\s*auto/s);
  });

  it("uses a premium workspace shell", () => {
    const app = allSource();
    const css = cssSource();

    expect(app).toContain("workspace-shell");
    expect(app).toContain("workspace-grid");

    expect(css).toContain(".workspace-shell");
    expect(css).toContain(".workspace-grid");
    expect(css).toContain("position: relative");
    expect(css).toContain("display: grid");
  });

  it("moves local agent setup into the room creation flow while keeping manual management fallback", () => {
    const source = allSource();

    expect(source).toContain("Create room and start agent");
    expect(source).toContain("createRoomWithLocalAgent");
    expect(source).toContain("Starting the local agent failed");
  });

  it("offers host-controlled Roundtable Mode controls", () => {
    const source = allSource();
    expect(source).toContain("Start Roundtable");
    expect(source).toContain("Submit to Agent");
    expect(source).toContain("Cancel Roundtable");
    expect(source).toContain("Roundtable Mode");
    expect(source).not.toContain("Start AI Collection");
    expect(source).not.toContain("Cancel Collection");
    expect(source).not.toContain("Collecting answers");
  });
});
