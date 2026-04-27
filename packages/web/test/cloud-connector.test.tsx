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
        isOwner={true}
        canManageRoom={true}
        onSelectAgent={() => {}}
        onCreateInvite={async () => undefined}
        cloudMode={true}
        createdPairing={{
          command: "cacp-connector --server https://cacp.zuchongai.com --pair cacp_pair",
          expires_at: "2026-04-27T16:30:00.000Z",
          permission_level: "read_only",
        }}
      />
    );

    expect(screen.getByText("Local Connector")).toBeInTheDocument();
    expect(
      screen.getByText("cacp-connector --server https://cacp.zuchongai.com --pair cacp_pair")
    ).toBeInTheDocument();
  });
});
