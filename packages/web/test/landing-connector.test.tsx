import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LangProvider } from "../src/i18n/LangProvider.js";
import Landing from "../src/components/Landing.js";

vi.mock("../src/runtime-config.js", () => ({
  isCloudMode: () => true
}));

describe("Landing cloud connector setup", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows connector download instructions and no working directory picker in cloud mode", () => {
    const { container } = render(
      <LangProvider>
        <Landing onCreate={() => {}} onJoin={() => {}} loading={false} />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Advanced options: Agent type and permission" }));
    expect(screen.getByRole("link", { name: "Download Local Connector" })).toHaveAttribute("href", "/downloads/CACP-Local-Connector.exe");
    expect(screen.getByText("Place the connector in your project folder, run it, then paste the room connection code.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Working directory")).not.toBeInTheDocument();
    expect(container.querySelector("input[webkitdirectory]")).toBeNull();
    expect(container.querySelector("input[directory]")).toBeNull();
  });

  it("shows only Claude Code as the local command agent option", () => {
    render(
      <LangProvider>
        <Landing onCreate={() => {}} onJoin={() => {}} loading={false} />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Advanced options: Agent type and permission" }));
    expect(screen.getByRole("option", { name: "Claude Code CLI" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Codex CLI" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "opencode CLI" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Echo Test Agent" })).not.toBeInTheDocument();
  });

  it("renders localized permission labels on the Chinese landing page", () => {
    window.localStorage.setItem("cacp.web.lang", "zh");
    render(
      <LangProvider>
        <Landing onCreate={() => {}} onJoin={() => {}} loading={false} />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "高级选项：Agent 类型和权限" }));
    expect(screen.getByRole("option", { name: "只读" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "受限写入" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "完全访问" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下载本地连接器" })).toBeInTheDocument();
  });

  it("starts create and join display names empty and requires a typed name", () => {
    render(
      <LangProvider>
        <Landing onCreate={() => {}} onJoin={() => {}} loading={false} />
      </LangProvider>
    );

    const createName = screen.getByLabelText("Your name") as HTMLInputElement;
    expect(createName).toHaveValue("");
    expect(createName).toBeRequired();
    expect(screen.getByRole("button", { name: "Create room and generate connector command" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Join with invite" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Invite link")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Room ID")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Invite token")).not.toBeInTheDocument();

    fireEvent.change(createName, { target: { value: "Alice" } });
    expect(screen.getByRole("button", { name: "Create room and generate connector command" })).not.toBeDisabled();
  });

  it("renders landing copyright and contact information", () => {
    render(
      <LangProvider>
        <Landing onCreate={() => {}} onJoin={() => {}} loading={false} />
      </LangProvider>
    );

    expect(screen.getByText("© 2026 ZuchongAI. All rights reserved.")).toBeInTheDocument();
    expect(screen.getByText("Contact: 453043662@qq.com, 1023289914@qq.com")).toBeInTheDocument();
  });

  it("renders localized Chinese footer contact information", () => {
    window.localStorage.setItem("cacp.web.lang", "zh");
    render(
      <LangProvider>
        <Landing onCreate={() => {}} onJoin={() => {}} loading={false} />
      </LangProvider>
    );

    expect(screen.getByText("© 2026 ZuchongAI。保留所有权利。")).toBeInTheDocument();
    expect(screen.getByText("联系方式：453043662@qq.com，1023289914@qq.com")).toBeInTheDocument();
  });

  it("shows LLM connector instructions in cloud mode", () => {
    render(
      <LangProvider>
        <Landing onCreate={() => {}} onJoin={() => {}} loading={false} />
      </LangProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Advanced options: Agent type and permission" }));
    fireEvent.change(screen.getByLabelText("Agent type"), { target: { value: "llm-api" } });
    expect(screen.queryByLabelText("Permission")).not.toBeInTheDocument();
    expect(screen.getByText("Download and run the connector, paste the connection code, then choose the LLM API provider and enter API settings in the connector console.")).toBeInTheDocument();
  });
});
