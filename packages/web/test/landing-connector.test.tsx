import { render, screen } from "@testing-library/react";
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

    expect(screen.getByRole("link", { name: "Download Local Connector" })).toHaveAttribute("href", "/downloads/CACP-Local-Connector.exe");
    expect(screen.getByText("Place the connector in your project folder, run it, then paste the room connection code.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Working directory")).not.toBeInTheDocument();
    expect(container.querySelector("input[webkitdirectory]")).toBeNull();
    expect(container.querySelector("input[directory]")).toBeNull();
  });

  it("renders localized permission labels on the Chinese landing page", () => {
    window.localStorage.setItem("cacp.web.lang", "zh");
    render(
      <LangProvider>
        <Landing onCreate={() => {}} onJoin={() => {}} loading={false} />
      </LangProvider>
    );

    expect(screen.getByRole("option", { name: "只读" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "受限写入" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "完全访问" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下载本地连接器" })).toBeInTheDocument();
  });
});
