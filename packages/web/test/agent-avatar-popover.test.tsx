import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { LangProvider } from "../src/i18n/LangProvider.js";
import { AgentAvatarPopover } from "../src/components/AgentAvatarPopover.js";

const agents = [
  { agent_id: "agent_1", name: "Claude Code", capabilities: ["repo.read"], status: "online" as const },
  { agent_id: "agent_2", name: "GPT-4", capabilities: ["chat"], status: "idle" as const },
];

describe("AgentAvatarPopover", () => {
  it("renders active agent name and status", () => {
    render(
      <LangProvider>
        <AgentAvatarPopover
          agents={agents}
          activeAgentId="agent_1"
          canManageRoom={true}
          claudeSessionPreviews={[]}
          claudeRuntimeStatuses={[]}
          serverUrl="http://localhost:3737"
          roomSessionToken="token"
          roomSessionParticipantId="user_1"
        />
      </LangProvider>
    );

    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("shows agent selector when multiple agents and can manage", () => {
    const onSelectAgent = vi.fn();
    render(
      <LangProvider>
        <AgentAvatarPopover
          agents={agents}
          activeAgentId="agent_1"
          canManageRoom={true}
          onSelectAgent={onSelectAgent}
          claudeSessionPreviews={[]}
          claudeRuntimeStatuses={[]}
          serverUrl="http://localhost:3737"
          roomSessionToken="token"
          roomSessionParticipantId="user_1"
        />
      </LangProvider>
    );

    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "agent_2" } });
    expect(onSelectAgent).toHaveBeenCalledWith("agent_2");
  });

  it("does not show agent selector when only one agent", () => {
    render(
      <LangProvider>
        <AgentAvatarPopover
          agents={[agents[0]]}
          activeAgentId="agent_1"
          canManageRoom={true}
          claudeSessionPreviews={[]}
          claudeRuntimeStatuses={[]}
          serverUrl="http://localhost:3737"
          roomSessionToken="token"
          roomSessionParticipantId="user_1"
        />
      </LangProvider>
    );

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("renders ClaudeStatusCard when runtime statuses exist", () => {
    render(
      <LangProvider>
        <AgentAvatarPopover
          agents={agents}
          activeAgentId="agent_1"
          canManageRoom={true}
          claudeSessionPreviews={[]}
          claudeRuntimeStatuses={[
            { status_id: "s1", agent_id: "agent_1", phase: "thinking", elapsed_ms: 1000, metrics: [], recent: [] }
          ]}
          serverUrl="http://localhost:3737"
          roomSessionToken="token"
          roomSessionParticipantId="user_1"
        />
      </LangProvider>
    );

    expect(screen.getByText("Thinking")).toBeInTheDocument();
  });
});
