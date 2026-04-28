import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LangProvider } from "../src/i18n/LangProvider.js";
import ConnectionCodeModal from "../src/components/ConnectionCodeModal.js";

const pairing = {
  connection_code: "CACP-CONNECT:v1:full-secret-code",
  download_url: "/downloads/CACP-Local-Connector.exe",
  expires_at: "2026-04-28T04:30:00.000Z"
};

function renderModal(writeText = vi.fn(async () => undefined), onClose = vi.fn()) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true
  });

  render(
    <LangProvider>
      <ConnectionCodeModal pairing={pairing} onClose={onClose} />
    </LangProvider>
  );

  return { onClose, writeText };
}

describe("ConnectionCodeModal", () => {
  it("renders download and copy actions for a generated connection code", () => {
    renderModal();

    expect(screen.getByRole("dialog", { name: "Connect local Agent" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download CACP-Local-Connector.exe" })).toHaveAttribute("href", pairing.download_url);
    expect(screen.getByRole("button", { name: "Copy connection code" })).toBeInTheDocument();
    expect(screen.getByText(/Connection code expires at/)).toBeInTheDocument();
  });

  it("copies the full connection code and shows copied feedback", async () => {
    const writeText = vi.fn(async () => undefined);
    renderModal(writeText);

    fireEvent.click(screen.getByRole("button", { name: "Copy connection code" }));

    expect(writeText).toHaveBeenCalledWith(pairing.connection_code);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("shows a manual copy field when clipboard copy fails", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("blocked");
    });
    renderModal(writeText);

    fireEvent.click(screen.getByRole("button", { name: "Copy connection code" }));

    expect(await screen.findByLabelText("Connection code for manual copy")).toHaveValue(pairing.connection_code);
    expect(screen.getByText("Copy failed. Select the code below and copy it manually.")).toBeInTheDocument();
  });

  it("shows a manual copy field when clipboard API is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true
    });
    render(
      <LangProvider>
        <ConnectionCodeModal pairing={pairing} onClose={() => {}} />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy connection code" }));

    expect(await screen.findByLabelText("Connection code for manual copy")).toHaveValue(pairing.connection_code);
    expect(screen.getByText("Copy failed. Select the code below and copy it manually.")).toBeInTheDocument();
  });

  it("calls onClose from the close button", () => {
    const { onClose } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing without a pairing", () => {
    const { container } = render(
      <LangProvider>
        <ConnectionCodeModal pairing={undefined} onClose={() => {}} />
      </LangProvider>
    );

    expect(container).toBeEmptyDOMElement();
  });
});
