import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { LangProvider } from "../src/i18n/LangProvider.js";
import { NotificationPanel } from "../src/components/NotificationPanel.js";

const joinRequests = [
  { request_id: "jr_1", display_name: "Alice", created_at: "2026-05-01T10:00:00Z" },
  { request_id: "jr_2", display_name: "Bob", created_at: "2026-05-01T10:05:00Z" },
];

describe("NotificationPanel", () => {
  it("renders empty state when no notifications", () => {
    render(
      <LangProvider>
        <NotificationPanel
          joinRequests={[]}
          turnInFlight={false}
          onApproveJoinRequest={vi.fn()}
          onRejectJoinRequest={vi.fn()}
        />
      </LangProvider>
    );

    expect(screen.getByText(/no notifications/i)).toBeInTheDocument();
  });

  it("renders join requests with approve and reject buttons", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(
      <LangProvider>
        <NotificationPanel
          joinRequests={joinRequests}
          turnInFlight={false}
          onApproveJoinRequest={onApprove}
          onRejectJoinRequest={onReject}
        />
      </LangProvider>
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();

    const approveButtons = screen.getAllByRole("button", { name: /approve/i });
    expect(approveButtons).toHaveLength(2);

    fireEvent.click(approveButtons[0]);
    expect(onApprove).toHaveBeenCalledWith("jr_1");

    const rejectButtons = screen.getAllByRole("button", { name: /reject/i });
    fireEvent.click(rejectButtons[1]);
    expect(onReject).toHaveBeenCalledWith("jr_2");
  });
});
