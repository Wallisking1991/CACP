import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { RoomIdentity } from "../src/components/RoomIdentity.js";

describe("RoomIdentity", () => {
  it("shows compact room identity and copies the full room id", () => {
    const onCopyRoomId = vi.fn();
    render(<RoomIdentity roomName="CACP AI Room" roomId="room_jPNCRNROwP3_isiArOvncw" userDisplayName="Wei" userRole="owner" onCopyRoomId={onCopyRoomId} />);

    expect(screen.getByText("CACP AI Room")).toBeInTheDocument();
    expect(screen.getByText("Wei · Owner")).toBeInTheDocument();
    expect(screen.getByText("room_jPNC…Ovncw")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Copy room ID/i }));
    expect(onCopyRoomId).toHaveBeenCalledWith("room_jPNCRNROwP3_isiArOvncw");
  });
});
