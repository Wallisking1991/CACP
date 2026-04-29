import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CacpHeroLogo from "../src/components/CacpHeroLogo.js";

const gsapMocks = vi.hoisted(() => {
  const timeline = { to: vi.fn() };
  timeline.to.mockImplementation(() => timeline);
  return {
    context: vi.fn((callback: () => void) => {
      callback();
      return { revert: vi.fn() };
    }),
    set: vi.fn(),
    timeline: vi.fn(() => timeline),
    to: vi.fn(),
    timelineTo: timeline.to,
  };
});

vi.mock("gsap", () => ({
  default: {
    context: gsapMocks.context,
    set: gsapMocks.set,
    timeline: gsapMocks.timeline,
    to: gsapMocks.to,
  },
}));

function setReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("CacpHeroLogo", () => {
  beforeEach(() => {
    gsapMocks.context.mockClear();
    gsapMocks.set.mockClear();
    gsapMocks.timeline.mockClear();
    gsapMocks.to.mockClear();
    gsapMocks.timelineTo.mockClear();
    setReducedMotion(false);
  });

  it("renders the CACP protocol room logo with an accessible label", () => {
    render(<CacpHeroLogo />);

    expect(screen.getByLabelText("CACP protocol room logo")).toBeInTheDocument();
    expect(screen.getByText("CACP")).toBeInTheDocument();
  });

  it("starts the GSAP timeline when motion is allowed", () => {
    render(<CacpHeroLogo />);

    expect(gsapMocks.context).toHaveBeenCalledTimes(1);
    expect(gsapMocks.timeline).toHaveBeenCalledTimes(1);
    expect(gsapMocks.set).toHaveBeenCalled();
    expect(gsapMocks.to).toHaveBeenCalled();
  });

  it("skips the GSAP timeline when reduced motion is requested", () => {
    setReducedMotion(true);

    render(<CacpHeroLogo />);

    const logo = screen.getByLabelText("CACP protocol room logo") as HTMLElement;
    expect(logo.dataset.motion).toBe("reduced");
    expect(gsapMocks.context).not.toHaveBeenCalled();
  });
});
