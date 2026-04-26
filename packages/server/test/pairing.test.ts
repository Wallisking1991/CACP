import { describe, expect, it } from "vitest";
import { buildAgentProfile } from "../src/pairing.js";

describe("agent pairing profiles", () => {
  it("generates a readable Claude Code system prompt with the CACP approval URL", () => {
    const profile = buildAgentProfile({
      agentType: "claude-code",
      permissionLevel: "limited_write",
      workingDir: "D:\\Development\\2",
      hookUrl: "http://127.0.0.1:3737/rooms/room_1/agent-action-approvals?token=agent_token"
    });
    const prompt = profile.args[profile.args.indexOf("--append-system-prompt") + 1];

    expect(prompt).toContain("CACP");
    expect(prompt).toContain("审批");
    expect(prompt).toContain("http://127.0.0.1:3737/rooms/room_1/agent-action-approvals?token=agent_token");
    expect(prompt).not.toContain("???");
  });
});
