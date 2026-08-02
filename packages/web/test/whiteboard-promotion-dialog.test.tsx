import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WhiteboardPromotionDialog } from "../src/components/WhiteboardPromotionDialog.js";

describe("WhiteboardPromotionDialog", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fails explicitly when the target Agent cannot receive both artifacts", () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    render(
      <WhiteboardPromotionDialog
        open
        session={{
          room_id: "room_1",
          participant_id: "owner_1",
          token: "secret",
          role: "owner",
        }}
        artifacts={{
          selectedElementIds: ["shape_1"],
          png: new Blob(["png"], { type: "image/png" }),
          source: new Blob(["source"], {
            type: "application/vnd.excalidraw+json",
          }),
        }}
        expectedRevision={3}
        agent={{
          agent_id: "agent_legacy",
          name: "Legacy Agent",
          capabilities: ["legacy"],
          status: "online",
          input_capabilities: {
            image: "native",
            pdf: "unsupported",
            text: "unsupported",
            office: "unsupported",
            file: "unsupported",
            max_attachments: 1,
          },
        }}
        onClose={() => {}}
      />
    );

    expect(
      screen.getByText(/cannot receive both required attachments/u)
    ).toHaveAttribute("role", "alert");
    expect(
      screen.getByRole("button", { name: "Create Main Input" })
    ).toBeDisabled();
  });
});
