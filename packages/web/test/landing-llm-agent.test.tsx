import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LangProvider } from "../src/i18n/LangProvider.js";
import Landing from "../src/components/Landing.js";

describe("Landing LLM API agent setup", () => {
  beforeEach(() => window.localStorage.clear());

  it("shows LLM API agent options including OpenAI-compatible and Anthropic-compatible", () => {
    render(<LangProvider><Landing onCreate={() => {}} onJoin={() => {}} /></LangProvider>);
    expect(screen.getByRole("group", { name: "Local Claude Code" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "LLM API agents" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "LLM API Agent" })).toHaveValue("llm-api");
    expect(screen.getByRole("option", { name: "OpenAI-compatible API" })).toHaveValue("llm-openai-compatible");
    expect(screen.getByRole("option", { name: "Anthropic-compatible API" })).toHaveValue("llm-anthropic-compatible");
  });

  it("hides permission selection and explains local API-key entry", () => {
    render(<LangProvider><Landing onCreate={() => {}} onJoin={() => {}} /></LangProvider>);
    fireEvent.change(screen.getByLabelText("Agent type"), { target: { value: "llm-api" } });
    expect(screen.queryByLabelText("Permission")).not.toBeInTheDocument();
    expect(screen.getByText("Provider and API key are configured only in the Local Connector console and are never sent to the room server.")).toBeInTheDocument();
  });

  it("submits read_only as server compatibility default for LLM API agents", () => {
    const onCreate = vi.fn();
    render(<LangProvider><Landing onCreate={onCreate} onJoin={() => {}} /></LangProvider>);
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Owner" } });
    fireEvent.change(screen.getByLabelText("Agent type"), { target: { value: "llm-api" } });
    fireEvent.click(screen.getByRole("button", { name: "Create room and start agent" }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ agentType: "llm-api", permissionLevel: "read_only" }));
  });
});
