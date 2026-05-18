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
          serverUrl="http://localhost:3737"
          roomSessionToken="token"
          roomSessionParticipantId="user_1"
        />
      </LangProvider>
    );

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows thinking toggle for owner and calls onUpdateAgentThinking", () => {
    const onUpdateAgentThinking = vi.fn();
    render(
      <LangProvider>
        <AgentAvatarPopover
          agents={agents}
          activeAgentId="agent_1"
          canManageRoom={true}
          isOwner={true}
          onUpdateAgentThinking={onUpdateAgentThinking}
          claudeSessionPreviews={[]}
          serverUrl="http://localhost:3737"
          roomSessionToken="token"
          roomSessionParticipantId="user_1"
        />
      </LangProvider>
    );

    const toggle = screen.getByRole("switch");
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);
    expect(onUpdateAgentThinking).toHaveBeenCalledWith("agent_1", false);
  });

  it("does not show thinking toggle when not owner", () => {
    render(
      <LangProvider>
        <AgentAvatarPopover
          agents={agents}
          activeAgentId="agent_1"
          canManageRoom={true}
          isOwner={false}
          claudeSessionPreviews={[]}
          serverUrl="http://localhost:3737"
          roomSessionToken="token"
          roomSessionParticipantId="user_1"
        />
      </LangProvider>
    );

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
