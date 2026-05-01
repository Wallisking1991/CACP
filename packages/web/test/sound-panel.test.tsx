import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { LangProvider } from "../src/i18n/LangProvider.js";
import { SoundPanel } from "../src/components/SoundPanel.js";

describe("SoundPanel", () => {
  it("renders sound toggle and volume slider", () => {
    render(
      <LangProvider>
        <SoundPanel
          soundEnabled={true}
          soundVolume={0.5}
          onSoundEnabledChange={vi.fn()}
          onSoundVolumeChange={vi.fn()}
          onTestSound={vi.fn()}
        />
      </LangProvider>
    );

    expect(screen.getByRole("switch", { name: /sound cues/i })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: /volume/i })).toBeInTheDocument();
  });

  it("calls onSoundEnabledChange when toggle is clicked", () => {
    const onSoundEnabledChange = vi.fn();
    render(
      <LangProvider>
        <SoundPanel
          soundEnabled={true}
          soundVolume={0.5}
          onSoundEnabledChange={onSoundEnabledChange}
          onSoundVolumeChange={vi.fn()}
          onTestSound={vi.fn()}
        />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole("switch", { name: /sound cues/i }));
    expect(onSoundEnabledChange).toHaveBeenCalledWith(false);
  });

  it("calls onSoundVolumeChange when slider changes", () => {
    const onSoundVolumeChange = vi.fn();
    render(
      <LangProvider>
        <SoundPanel
          soundEnabled={true}
          soundVolume={0.5}
          onSoundEnabledChange={vi.fn()}
          onSoundVolumeChange={onSoundVolumeChange}
          onTestSound={vi.fn()}
        />
      </LangProvider>
    );

    fireEvent.change(screen.getByRole("slider", { name: /volume/i }), { target: { value: "0.75" } });
    expect(onSoundVolumeChange).toHaveBeenCalledWith(0.75);
  });

  it("calls onTestSound when test button is clicked", () => {
    const onTestSound = vi.fn();
    render(
      <LangProvider>
        <SoundPanel
          soundEnabled={true}
          soundVolume={0.5}
          onSoundEnabledChange={vi.fn()}
          onSoundVolumeChange={vi.fn()}
          onTestSound={onTestSound}
        />
      </LangProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /test/i }));
    expect(onTestSound).toHaveBeenCalled();
  });
});
