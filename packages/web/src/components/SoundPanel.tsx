import { useT } from "../i18n/useT.js";

export interface SoundPanelProps {
  soundEnabled: boolean;
  soundVolume: number;
  onSoundEnabledChange: (enabled: boolean) => void;
  onSoundVolumeChange: (volume: number) => void;
  onTestSound: () => void;
}

export function SoundPanel({
  soundEnabled,
  soundVolume,
  onSoundEnabledChange,
  onSoundVolumeChange,
  onTestSound,
}: SoundPanelProps) {
  const t = useT();

  return (
    <div className="popover-content sound-popover">
      <h3 className="popover-title">{t("room.sound")}</h3>
      <button
        type="button"
        role="switch"
        aria-checked={soundEnabled}
        onClick={() => onSoundEnabledChange(!soundEnabled)}
        className="btn btn-ghost"
      >
        {t("room.soundCues")}
      </button>
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
        <label htmlFor="sound-volume" style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {t("room.soundVolume")}
        </label>
        <input
          id="sound-volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={soundVolume}
          onChange={(e) => onSoundVolumeChange(Number(e.target.value))}
          aria-label={t("room.soundVolume")}
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: 12, color: "var(--ink-3)", minWidth: 36, textAlign: "right" }}>
          {Math.round(soundVolume * 100)}%
        </span>
      </div>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onTestSound}
        style={{ marginTop: 8 }}
      >
        {t("room.testSound")}
      </button>
    </div>
  );
}
