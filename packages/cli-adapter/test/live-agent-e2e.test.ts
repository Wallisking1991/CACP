import { describe, expect, it } from "vitest";
import { ClaudeRuntime } from "../src/claude/runtime.js";
import { CodexRuntime } from "../src/codex/runtime.js";
import { CopilotRuntime } from "../src/copilot/runtime.js";
import { KimiRuntime } from "../src/kimi/runtime.js";

const liveEnabled = process.env.CACP_LIVE_AGENT_E2E === "1";
const selectedAgent = process.env.CACP_LIVE_AGENT ?? "all";
const workingDir = process.env.CACP_LIVE_AGENT_WORKDIR ?? process.cwd();
const prompt =
  "This is a CACP adapter compatibility check. Do not call tools or modify files. Reply with exactly CACP_E2E_OK.";

function enabled(agent: string): boolean {
  return liveEnabled && (selectedAgent === "all" || selectedAgent === agent);
}

const traceSink = {
  publishDelta: async () => undefined,
  startNode: async () => undefined,
  appendNodeDelta: async () => undefined,
  updateNode: async () => undefined,
  completeNode: async () => undefined,
  failNode: async () => undefined,
};

const turn = {
  turnId: "turn_live_e2e",
  roomName: "CACP Live E2E",
  speakerName: "Compatibility Bot",
  speakerRole: "owner",
  modeLabel: "normal",
  text: prompt,
};

function expectCompatibilityReply(finalText: string) {
  expect(finalText.trim().toUpperCase()).toContain("CACP_E2E_OK");
}

describe("authenticated Local Tool Agent compatibility", () => {
  it.skipIf(!enabled("claude-code"))(
    "completes a real Claude Code SDK turn",
    async () => {
      const runtime = new ClaudeRuntime({
        agentId: "agent_live_claude",
        workingDir,
        permissionLevel: "read_only",
        model: process.env.CACP_LIVE_CLAUDE_MODEL ?? "claude-sonnet-4-20250514",
        ...traceSink,
        requestApproval: async () => ({
          decision: "deny" as const,
          resolved_by: "live_e2e",
          resolved_at: new Date().toISOString(),
        }),
        requestElicitation: async () => ({
          action: "cancel" as const,
          resolved_by: "live_e2e",
          resolved_at: new Date().toISOString(),
        }),
      });
      try {
        await runtime.selectSession({ mode: "fresh" });
        expectCompatibilityReply((await runtime.runTurn(turn)).finalText);
      } finally {
        await runtime.close();
      }
    },
    180_000
  );

  it.skipIf(!enabled("codex-cli"))(
    "completes a real Codex SDK turn",
    async () => {
      const runtime = new CodexRuntime({
        agentId: "agent_live_codex",
        workingDir,
        permissionLevel: "read_only",
        model: process.env.CACP_LIVE_CODEX_MODEL,
        ...traceSink,
      });
      try {
        await runtime.selectSession({ mode: "fresh" });
        expectCompatibilityReply((await runtime.runTurn(turn)).finalText);
      } finally {
        await runtime.close();
      }
    },
    180_000
  );

  it.skipIf(!enabled("github-copilot"))(
    "completes a real GitHub Copilot SDK turn",
    async () => {
      const runtime = new CopilotRuntime({
        agentId: "agent_live_copilot",
        workingDir,
        permissionLevel: "read_only",
        model: process.env.CACP_LIVE_COPILOT_MODEL,
        ...traceSink,
      });
      try {
        await runtime.selectSession({ mode: "fresh" });
        expectCompatibilityReply((await runtime.runTurn(turn)).finalText);
      } finally {
        await runtime.close();
      }
    },
    180_000
  );

  it.skipIf(!enabled("kimi-cli"))(
    "completes a real Kimi SDK turn",
    async () => {
      const runtime = new KimiRuntime({
        agentId: "agent_live_kimi",
        agentName: "Kimi Code",
        workingDir,
        permissionLevel: "read_only",
        model: process.env.CACP_LIVE_KIMI_MODEL,
        thinking: false,
        ...traceSink,
        requestApproval: async () => ({
          decision: "deny" as const,
          resolved_by: "live_e2e",
          resolved_at: new Date().toISOString(),
        }),
        requestElicitation: async () => ({
          action: "cancel" as const,
          resolved_by: "live_e2e",
          resolved_at: new Date().toISOString(),
        }),
      });
      try {
        await runtime.selectSession({ mode: "fresh" });
        expectCompatibilityReply((await runtime.runTurn(turn)).finalText);
      } finally {
        await runtime.close();
      }
    },
    180_000
  );
});
