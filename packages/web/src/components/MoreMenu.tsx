import { useRef, useState, useCallback } from "react";
import { Popover } from "./Popover.js";
import { MenuIcon, SoundIcon, GlobeIcon, LogOutIcon } from "./RoomIcons.js";
import { SoundPanel } from "./SoundPanel.js";
import { LogPanel } from "./LogPanel.js";

export interface MoreMenuProps {
  // Sound
  soundEnabled?: boolean;
  soundVolume?: number;
  onSoundEnabledChange?: (enabled: boolean) => void;
  onSoundVolumeChange?: (volume: number) => void;
  onTestSound?: () => void;
  // Language
  currentLang?: string; // "en" or "zh"
  onToggleLang?: () => void;
  // Leave
  onLeaveRoom?: () => void;
}

type SubPanel = "sound" | "logs" | null;

export function MoreMenu({
  soundEnabled = false,
  soundVolume = 0.5,
  onSoundEnabledChange,
  onSoundVolumeChange,
  onTestSound,
  currentLang = "en",
  onToggleLang,
  onLeaveRoom,
}: MoreMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [subPanel, setSubPanel] = useState<SubPanel>(null);

  const handleOpen = useCallback(() => {
    setOpen(true);
    setSubPanel(null);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setSubPanel(null);
  }, []);

  const handleToggleLang = useCallback(() => {
    onToggleLang?.();
    setOpen(false);
    setSubPanel(null);
  }, [onToggleLang]);

  const handleLeaveRoom = useCallback(() => {
    onLeaveRoom?.();
    setOpen(false);
    setSubPanel(null);
  }, [onLeaveRoom]);

  const langLabel = currentLang === "zh" ? "语言" : "Language";
  const langCode = currentLang === "zh" ? "ZH" : "EN";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="more-menu-button"
        aria-label="More options"
        onClick={handleOpen}
      >
        <MenuIcon />
      </button>
      <Popover triggerRef={triggerRef} open={open} onClose={handleClose}>
        {subPanel === null ? (
          <div className="more-menu-list">
            <button
              type="button"
              className="more-menu-item"
              onClick={() => setSubPanel("sound")}
            >
              <SoundIcon />
              <span>Sound</span>
            </button>
            <button
              type="button"
              className="more-menu-item"
              onClick={() => setSubPanel("logs")}
            >
              <span style={{ fontSize: 14, fontWeight: 700, width: 18, textAlign: "center" }}>L</span>
              <span>Logs</span>
            </button>
            <div className="more-menu-divider" />
            <button
              type="button"
              className="more-menu-item"
              onClick={handleToggleLang}
            >
              <GlobeIcon />
              <span>{langLabel}: {langCode}</span>
            </button>
            <div className="more-menu-divider" />
            <button
              type="button"
              className="more-menu-item more-menu-item--danger"
              onClick={handleLeaveRoom}
            >
              <LogOutIcon />
              <span>Leave room</span>
            </button>
          </div>
        ) : subPanel === "sound" ? (
          <div>
            <button
              type="button"
              className="more-menu-back"
              onClick={() => setSubPanel(null)}
            >
              <span>←</span>
              <span>Back</span>
            </button>
            <SoundPanel
              soundEnabled={soundEnabled}
              soundVolume={soundVolume}
              onSoundEnabledChange={onSoundEnabledChange ?? (() => {})}
              onSoundVolumeChange={onSoundVolumeChange ?? (() => {})}
              onTestSound={onTestSound ?? (() => {})}
            />
          </div>
        ) : (
          <div>
            <button
              type="button"
              className="more-menu-back"
              onClick={() => setSubPanel(null)}
            >
              <span>←</span>
              <span>Back</span>
            </button>
            <LogPanel />
          </div>
        )}
      </Popover>
    </>
  );
}
