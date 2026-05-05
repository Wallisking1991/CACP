import { describe, it, expect } from "vitest";
import { assignAgentColor } from "../src/components/agent-ripple-utils.js";

describe("assignAgentColor", () => {
  it("returns an hsl color string for an agent id", () => {
    const color = assignAgentColor("agent-1");
    expect(color).toMatch(/^hsl\(\d+,?\s*\d+%?,?\s*\d+%?\)/);
  });

  it("returns the same color for the same agent id", () => {
    const color1 = assignAgentColor("agent-abc");
    const color2 = assignAgentColor("agent-abc");
    expect(color1).toBe(color2);
  });

  it("returns different colors for different agent ids", () => {
    const color1 = assignAgentColor("agent-a");
    const color2 = assignAgentColor("agent-b");
    expect(color1).not.toBe(color2);
  });

  it("produces colors in the tech hue range (180-320)", () => {
    const colors = [
      assignAgentColor("agent-1"),
      assignAgentColor("agent-2"),
      assignAgentColor("agent-3"),
      assignAgentColor("agent-4"),
      assignAgentColor("agent-5"),
    ];
    for (const color of colors) {
      const match = color.match(/hsl\((\d+)/);
      expect(match).not.toBeNull();
      const hue = parseInt(match![1], 10);
      expect(hue).toBeGreaterThanOrEqual(180);
      expect(hue).toBeLessThanOrEqual(320);
    }
  });
});
