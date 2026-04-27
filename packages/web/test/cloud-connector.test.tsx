import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Sidebar from "../src/components/Sidebar.js";

describe("cloud connector UI", () => {
  it("renders connector command in cloud mode", () => {
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
          connection_code: "CACP-CONNECT:v1:eyJzZXJ2ZXJfdXJsIjoiaHR0cHM6Ly9jYWNwLnp1Y2hvbmdhaS5jb20iLCJwYWlyaW5nX3Rva2VuIjoiY2FjcF9wYWlyIiwicm9vbV9pZCI6InJvb21fMSIsImFnZW50X3R5cGUiOiJjbGF1ZGUtY29kZSIsInBlcm1pc3Npb25fbGV2ZWwiOiJmdWxsX2FjY2VzcyIsImV4cGlyZXNfYXQiOiIyMDI2LTA0LTI3VDE2OjMwOjAwLjAwMFoifQ",
          download_url: "/downloads/CACP-Local-Connector.exe",
          expires_at: "2026-04-27T16:30:00.000Z",
        }}
      />
    );

    expect(screen.getByText("Local Connector")).toBeInTheDocument();
    expect(
      screen.getByText("Download connector")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Copy connection code")
    ).toBeInTheDocument();
  });
});
