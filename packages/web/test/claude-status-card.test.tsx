import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClaudeStatusCard } from "../src/components/ClaudeStatusCard.js";

describe("ClaudeStatusCard", () => {
  it("renders one rolling card with bounded recent status entries", () => {
    render(
      <ClaudeStatusCard
        status={{
          agent_id: "agent_1",
          turn_id: "turn_1",
          status_id: "status_turn_1",
          phase: "reading_files",
          current: "Reading packages/server/src/pairing.ts",
          recent: Array.from({ length: 12 }, (_, index) => `step ${index}`),
          metrics: { files_read: 3, searches: 1, commands: 0 },
          started_at: "2026-04-29T00:00:00.000Z",
          updated_at: "2026-04-29T00:00:10.000Z"
        }}
      />
    );

    expect(screen.getByText(/Reading packages\/server\/src\/pairing.ts/)).toBeInTheDocument();
    expect(screen.getByText(/read 3 files/)).toBeInTheDocument();
    expect(screen.queryByText("step 0")).not.toBeInTheDocument();
    expect(screen.getByText("step 11")).toBeInTheDocument();
  });
});
