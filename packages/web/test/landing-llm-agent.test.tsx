import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LangProvider } from "../src/i18n/LangProvider.js";
import Landing from "../src/components/Landing.js";

vi.mock("../src/runtime-config.js", () => ({ isCloudMode: () => false }));

describe("Landing LLM API agent setup", () => {
  beforeEach(() => window.localStorage.clear());

  it("shows LLM API agent choices grouped with command agents", () => {
    render(<LangProvider><Landing onCreate={() => {}} onJoin={() => {}} /></LangProvider>);
    expect(screen.getByRole("group", { name: "Local command agents" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "LLM API agents" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "OpenAI-compatible API" })).toHaveValue("llm-openai-compatible");
    expect(screen.getByRole("option", { name: "Anthropic-compatible API" })).toHaveValue("llm-anthropic-compatible");
  });

  it("hides permission selection and explains local API-key entry", () => {
    render(<LangProvider><Landing onCreate={() => {}} onJoin={() => {}} /></LangProvider>);
    fireEvent.change(screen.getByLabelText("Agent type"), { target: { value: "llm-openai-compatible" } });
    expect(screen.queryByLabelText("Permission")).not.toBeInTheDocument();
    expect(screen.getByText("API keys are entered only in the Local Connector console and are never sent to the room server.")).toBeInTheDocument();
  });

  it("submits read_only as server compatibility default for LLM API agents", () => {
    const onCreate = vi.fn();
    render(<LangProvider><Landing onCreate={onCreate} onJoin={() => {}} /></LangProvider>);
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Owner" } });
    fireEvent.change(screen.getByLabelText("Agent type"), { target: { value: "llm-anthropic-compatible" } });
    fireEvent.click(screen.getByRole("button", { name: "Create room and start agent" }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ agentType: "llm-anthropic-compatible", permissionLevel: "read_only" }));
  });
});
