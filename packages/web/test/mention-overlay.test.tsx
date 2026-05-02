import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import MentionOverlay from "../src/components/MentionOverlay.js";

describe("MentionOverlay", () => {
  it("renders plain text when no mentions", () => {
    const { container } = render(<MentionOverlay text="Hello world" />);
    expect(container.textContent).toBe("Hello world");
  });

  it("wraps @agent mentions in agent span", () => {
    const { container } = render(
      <MentionOverlay text="Hello @Claude" mentions={[{ start: 6, end: 13, type: "agent" }]} />
    );
    const span = container.querySelector(".mention-overlay__agent");
    expect(span).toBeInTheDocument();
    expect(span?.textContent).toBe("@Claude");
  });

  it("wraps @user mentions in user span", () => {
    const { container } = render(
      <MentionOverlay text="Hi @Alice" mentions={[{ start: 3, end: 9, type: "user" }]} />
    );
    const span = container.querySelector(".mention-overlay__user");
    expect(span).toBeInTheDocument();
    expect(span?.textContent).toBe("@Alice");
  });
});
