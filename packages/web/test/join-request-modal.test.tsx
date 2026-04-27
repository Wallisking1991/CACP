import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { LangProvider } from "../src/i18n/LangProvider.js";
import JoinRequestModal from "../src/components/JoinRequestModal.js";

const request = {
  request_id: "join_req_1",
  display_name: "Bob",
  status: "pending" as const,
  created_at: "2026-04-27T12:00:00.000Z"
};

function renderModal(props: Partial<ComponentProps<typeof JoinRequestModal>> = {}) {
  const onApprove = props.onApprove ?? vi.fn();
  const onReject = props.onReject ?? vi.fn();
  const onLater = props.onLater ?? vi.fn();
  render(
    <LangProvider>
      <JoinRequestModal
        request={request}
        remainingCount={0}
        onApprove={onApprove}
        onReject={onReject}
        onLater={onLater}
        {...props}
      />
    </LangProvider>
  );
  return { onApprove, onReject, onLater };
}

describe("JoinRequestModal", () => {
  it("renders the pending requester with clear actions", () => {
    renderModal();

    expect(screen.getByRole("dialog", { name: "Join request" })).toBeInTheDocument();
    expect(screen.getByText("Bob wants to join this room.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Later" })).toBeInTheDocument();
  });

  it("calls approve reject and later callbacks with the request id", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onLater = vi.fn();
    renderModal({ onApprove, onReject, onLater });

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    expect(onApprove).toHaveBeenCalledWith("join_req_1");
    expect(onReject).toHaveBeenCalledWith("join_req_1");
    expect(onLater).toHaveBeenCalledWith("join_req_1");
  });

  it("renders nothing when no request is provided", () => {
    const { container } = render(
      <LangProvider>
        <JoinRequestModal request={undefined} remainingCount={0} onApprove={() => {}} onReject={() => {}} onLater={() => {}} />
      </LangProvider>
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("mentions additional pending requests", () => {
    renderModal({ remainingCount: 2 });

    expect(screen.getByText("2 more requests are waiting.")).toBeInTheDocument();
  });
});
