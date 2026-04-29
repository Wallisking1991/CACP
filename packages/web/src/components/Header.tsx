import { useCallback } from "react";
import { useT } from "../i18n/useT.js";
import { LangContext, type Lang } from "../i18n/LangProvider.js";
import { useContext } from "react";

export interface HeaderProps {
  roomName: string;
  roomId: string;
  userDisplayName?: string;
  participantCount: number;
  agentName?: string;
  agentOnline?: boolean;
  mode: "live" | "collect" | "replying";
  isOwner: boolean;
  onClearRoom: () => void;
  onLeaveRoom: () => void;
  onOpenDrawer?: () => void;
}

function statusPillClass(mode: HeaderProps["mode"]): string {
  switch (mode) {
    case "replying": return "status-pill";
    case "collect": return "status-pill";
    default: return "status-pill";
  }
}

function statusDotClass(mode: HeaderProps["mode"], agentOnline?: boolean): string {
  const base = "status-dot";
  if (mode === "replying") return `${base} pulse`;
  if (mode === "collect") return `${base}`;
  if (agentOnline) return `${base} online`;
  return base;
}

function statusDotStyle(mode: HeaderProps["mode"], agentOnline?: boolean): React.CSSProperties {
  if (mode === "replying") return { background: "var(--accent)" };
  if (mode === "collect") return { background: "var(--accent)" };
  if (agentOnline) return { background: "var(--success)" };
  return {};
}

export default function Header({
  roomName,
  roomId,
  userDisplayName,
  participantCount,
  agentName,
  agentOnline,
  mode,
  isOwner,
  onClearRoom,
  onLeaveRoom,
  onOpenDrawer,
}: HeaderProps) {
  const t = useT();
  const langCtx = useContext(LangContext);

  const handleToggleLang = useCallback(() => {
    const next: Lang = langCtx?.lang === "zh" ? "en" : "zh";
    langCtx?.setLang(next);
  }, [langCtx]);

  const agentStatusText = agentName
    ? agentOnline
      ? t("header.agentOnline", { name: agentName })
      : t("header.agentOffline", { name: agentName })
    : t("header.noAgent");

  const modeLabel =
    mode === "live"
      ? t("header.statusLive")
      : mode === "collect"
      ? t("header.statusCollect")
      : t("header.statusReplying");

  return (
    <header className="workspace-header">
      <div className="header-title">
        <h2>
          {roomName}
          {userDisplayName ? <> · {userDisplayName}</> : null}
        </h2>
        <p className="header-sub">
          {t("header.room")} · {t("header.peopleCount", { count: participantCount })} · {agentStatusText}
        </p>
        <p className="header-sub" style={{ marginTop: 2, fontSize: 11, color: "var(--ink-5)" }}>
          {roomId}
        </p>
      </div>

      <div className="header-actions">
        <span className={statusPillClass(mode)}>
          <span
            className={statusDotClass(mode, agentOnline)}
            style={statusDotStyle(mode, agentOnline)}
          />
          {modeLabel}
        </span>

        <button
          type="button"
          className="lang-toggle"
          onClick={handleToggleLang}
          aria-label={t("lang.toggle")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M2 12h20" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        </button>

        {isOwner && (
          <button
            type="button"
            className="btn btn-ghost header-danger-action"
            style={{ color: "var(--danger)" }}
            onClick={onClearRoom}
            title={t("room.clear")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            <span className="btn-label">{t("room.clear")}</span>
          </button>
        )}

        <button type="button" className="btn btn-ghost" onClick={onLeaveRoom} title={t("room.leave")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <path d="M21 12H9" />
          </svg>
          <span className="btn-label">{t("room.leave")}</span>
        </button>

        {onOpenDrawer && (
          <button
            type="button"
            className="overflow-menu-btn"
            onClick={onOpenDrawer}
            aria-label={t("header.openMenu")}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 4h12M2 8h12M2 12h12" />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}
