import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Sidebar, { maskConnectionCode } from "../src/components/Sidebar.js";

const fullConnectionCode = "CACP-CONNECT:v1:eyJzZXJ2ZXJfdXJsIjoiaHR0cHM6Ly9jYWNwLnp1Y2hvbmdhaS5jb20iLCJwYWlyaW5nX3Rva2VuIjoiY2FjcF9wYWlyIiwicm9vbV9pZCI6InJvb21fMSIsImFnZW50X3R5cGUiOiJjbGF1ZGUtY29kZSIsInBlcm1pc3Npb25fbGV2ZWwiOiJmdWxsX2FjY2VzcyIsImV4cGlyZXNfYXQiOiIyMDI2LTA0LTI3VDE2OjMwOjAwLjAwMFoifQ";

function renderSidebar(writeText = vi.fn(async () => undefined)) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true
  });

  render(
    <Sidebar
      agents={[]}
      participants={[]}
      inviteCount={0}
      joinRequests={[]}
      isOwner={true}
      canManageRoom={true}
      onSelectAgent={() => {}}
      onCreateInvite={async () => undefined}
      onApproveJoinRequest={() => {}}
      onRejectJoinRequest={() => {}}
      onRemoveParticipant={() => {}}
      cloudMode={true}
      createdPairing={{
        connection_code: fullConnectionCode,
        download_url: "/downloads/CACP-Local-Connector.exe",
        expires_at: "2026-04-27T16:30:00.000Z"
      }}
    />
  );

  return { writeText };
}

describe("cloud connector UI", () => {
  it("masks the connector code instead of rendering the full secret", () => {
    renderSidebar();

    expect(screen.getByText("Local Connector")).toBeInTheDocument();
    expect(screen.getByText("Download connector")).toBeInTheDocument();
    expect(screen.getByText("Copy connection code")).toBeInTheDocument();
    expect(screen.queryByText(fullConnectionCode)).not.toBeInTheDocument();
    expect(screen.getByText(maskConnectionCode(fullConnectionCode))).toBeInTheDocument();
  });

  it("copies the full connector code and shows copied feedback", async () => {
    const writeText = vi.fn(async () => undefined);
    renderSidebar(writeText);

    fireEvent.click(screen.getByRole("button", { name: "Copy connection code" }));

    expect(writeText).toHaveBeenCalledWith(fullConnectionCode);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("masks short connection codes deterministically", () => {
    expect(maskConnectionCode("abc123")).toBe("••••abc123");
  });
});
