import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { LangProvider } from "../src/i18n/LangProvider.js";
import { NotificationPanel } from "../src/components/NotificationPanel.js";

const joinRequests = [
  { request_id: "jr_1", display_name: "Alice", created_at: "2026-05-01T10:00:00Z" },
  { request_id: "jr_2", display_name: "Bob", created_at: "2026-05-01T10:05:00Z" },
];

const roundtableRequest = {
  request_id: "rt_1",
  display_name: "Charlie",
  created_at: "2026-05-01T10:10:00Z",
};

describe("NotificationPanel", () => {
  it("renders empty state when no notifications", () => {
    render(
      <LangProvider>
        <NotificationPanel
          joinRequests={[]}
          roundtableRequest={undefined}
          turnInFlight={false}
          onApproveJoinRequest={vi.fn()}
          onRejectJoinRequest={vi.fn()}
          onApproveRoundtableRequest={vi.fn()}
          onRejectRoundtableRequest={vi.fn()}
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
          roundtableRequest={undefined}
          turnInFlight={false}
          onApproveJoinRequest={onApprove}
          onRejectJoinRequest={onReject}
          onApproveRoundtableRequest={vi.fn()}
          onRejectRoundtableRequest={vi.fn()}
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

  it("renders roundtable request with start and reject buttons", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(
      <LangProvider>
        <NotificationPanel
          joinRequests={[]}
          roundtableRequest={roundtableRequest}
          turnInFlight={false}
          onApproveJoinRequest={vi.fn()}
          onRejectJoinRequest={vi.fn()}
          onApproveRoundtableRequest={onApprove}
          onRejectRoundtableRequest={onReject}
        />
      </LangProvider>
    );

    expect(screen.getByText("Charlie")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    expect(onApprove).toHaveBeenCalledWith("rt_1");

    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(onReject).toHaveBeenCalledWith("rt_1");
  });

  it("disables start button when turn is in flight", () => {
    render(
      <LangProvider>
        <NotificationPanel
          joinRequests={[]}
          roundtableRequest={roundtableRequest}
          turnInFlight={true}
          onApproveJoinRequest={vi.fn()}
          onRejectJoinRequest={vi.fn()}
          onApproveRoundtableRequest={vi.fn()}
          onRejectRoundtableRequest={vi.fn()}
        />
      </LangProvider>
    );

    const startBtn = screen.getByRole("button", { name: /start/i });
    expect(startBtn).toBeDisabled();
  });
});
