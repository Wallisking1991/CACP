import { useContext, useEffect, useMemo, useState } from "react";
import { parseInviteUrl } from "../api.js";
import { LangContext } from "../i18n/LangProvider.js";
import { useT } from "../i18n/useT.js";
import { isCloudMode } from "../runtime-config.js";

interface LandingProps {
  onCreate: (params: { roomName: string; displayName: string; agentType: string; permissionLevel: string }) => void;
  onJoin: (params: { roomId: string; inviteToken: string; displayName: string }) => void;
  loading?: boolean;
}

const agentTypes = [
  { value: "claude-code", labelKey: "agentType.claudeCode" },
  { value: "codex", labelKey: "agentType.codex" },
  { value: "opencode", labelKey: "agentType.opencode" },
  { value: "echo", labelKey: "agentType.echo" }
] as const;

const permissionLevels = [
  { value: "read_only", labelKey: "permission.readOnly" },
  { value: "limited_write", labelKey: "permission.limitedWrite" },
  { value: "full_access", labelKey: "permission.fullAccess" }
] as const;

export default function Landing({ onCreate, onJoin, loading }: LandingProps) {
  const t = useT();
  const langCtx = useContext(LangContext);

  const inviteTarget = useMemo(() => parseInviteUrl(window.location.search) ?? parseInviteUrl(window.location.hash.replace(/^#/, "?")), []);
  const hasInviteInUrl = Boolean(inviteTarget);

  const [activeTab, setActiveTab] = useState<"create" | "join">(hasInviteInUrl ? "join" : "create");

  const [roomName, setRoomName] = useState("CACP AI Room");
  const [displayName, setDisplayName] = useState("Alice");
  const [agentType, setAgentType] = useState("claude-code");
  const [permissionLevel, setPermissionLevel] = useState("read_only");

  const [joinRoomId, setJoinRoomId] = useState(inviteTarget?.room_id ?? "");
  const [inviteToken, setInviteToken] = useState(inviteTarget?.invite_token ?? "");
  const [inviteLink, setInviteLink] = useState("");

  useEffect(() => {
    if (hasInviteInUrl) {
      setActiveTab("join");
      if (inviteTarget) {
        setJoinRoomId(inviteTarget.room_id);
        setInviteToken(inviteTarget.invite_token);
      }
    }
  }, [hasInviteInUrl, inviteTarget]);

  useEffect(() => {
    if (inviteLink.trim()) {
      try {
        const url = new URL(inviteLink.trim());
        const parsed = parseInviteUrl(url.search);
        if (parsed) {
          setJoinRoomId(parsed.room_id);
          setInviteToken(parsed.invite_token);
        }
      } catch {
        // ignore invalid URL
      }
    }
  }, [inviteLink]);

  const createValid = roomName.trim() && displayName.trim();
  const joinValid = joinRoomId.trim() && inviteToken.trim() && displayName.trim();

  function handleCreateSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!createValid || loading) return;
    onCreate({
      roomName: roomName.trim(),
      displayName: displayName.trim(),
      agentType,
      permissionLevel
    });
  }

  function handleJoinSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!joinValid || loading) return;
    onJoin({
      roomId: joinRoomId.trim(),
      inviteToken: inviteToken.trim(),
      displayName: displayName.trim()
    });
  }

  return (
    <main className="landing-shell">
      <div className="landing-card">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <button
            type="button"
            className="lang-toggle"
            onClick={() => langCtx?.setLang(langCtx.lang === "en" ? "zh" : "en")}
            title={t("lang.toggle")}
            aria-label={t("lang.toggle")}
          >
            {t("lang.en")} / {t("lang.zh")}
          </button>
        </div>

        <p className="landing-eyebrow">{t("landing.eyebrow")}</p>
        <h1 className="landing-headline">{t("landing.headline")}</h1>
        <p className="landing-subcopy">{t("landing.subcopy")}</p>

        <div className="tab-bar">
          <button
            type="button"
            className={`tab-btn ${activeTab === "create" ? "active" : ""}`}
            onClick={() => setActiveTab("create")}
          >
            {t("landing.tab.create")}
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "join" ? "active" : ""}`}
            onClick={() => setActiveTab("join")}
          >
            {t("landing.tab.join")}
          </button>
        </div>

        {activeTab === "create" ? (
          <form onSubmit={handleCreateSubmit}>
            <label className="section-label" htmlFor="landing-room-name">{t("landing.create.roomName")}</label>
            <input
              id="landing-room-name"
              className="input"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              required
            />

            <label className="section-label" htmlFor="landing-display-name" style={{ marginTop: 12 }}>{t("landing.create.displayName")}</label>
            <input
              id="landing-display-name"
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />

            <label className="section-label" htmlFor="landing-agent-type" style={{ marginTop: 12 }}>{t("landing.create.agentType")}</label>
            <select
              id="landing-agent-type"
              className="input"
              value={agentType}
              onChange={(e) => setAgentType(e.target.value)}
            >
              {agentTypes.map((item) => (
                <option key={item.value} value={item.value}>{t(item.labelKey)}</option>
              ))}
            </select>

            <label className="section-label" htmlFor="landing-permission-level" style={{ marginTop: 12 }}>{t("landing.create.permissionLevel")}</label>
            <select
              id="landing-permission-level"
              className="input"
              value={permissionLevel}
              onChange={(e) => setPermissionLevel(e.target.value)}
            >
              {permissionLevels.map((item) => (
                <option key={item.value} value={item.value}>{t(item.labelKey)}</option>
              ))}
            </select>

            {isCloudMode() && (
              <div className="connector-setup" style={{ marginTop: 16, padding: 12, border: "1px solid var(--border-soft)", borderRadius: "var(--radius-card)", background: "var(--surface-warm)" }}>
                <a className="btn btn-ghost" href="/downloads/CACP-Local-Connector.exe" download>
                  {t("landing.connector.download")}
                </a>
                <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8 }}>{t("landing.connector.instructions")}</p>
              </div>
            )}

            <button
              type="submit"
              className="btn btn-warm"
              disabled={!createValid || loading}
              style={{ marginTop: 16 }}
            >
              {isCloudMode() ? t("landing.create.cloudCta") : t("landing.create.cta")}
            </button>
            {isCloudMode() && (
              <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8 }}>{t("landing.create.cloudAgentHint")}</p>
            )}
          </form>
        ) : (
          <form onSubmit={handleJoinSubmit}>
            {!hasInviteInUrl && (
              <>
                <label className="section-label" htmlFor="landing-invite-link">{t("landing.join.inviteLink")}</label>
                <input
                  id="landing-invite-link"
                  className="input"
                  value={inviteLink}
                  onChange={(e) => setInviteLink(e.target.value)}
                  placeholder="https://..."
                />
              </>
            )}

            <label className="section-label" htmlFor="landing-join-room-id" style={{ marginTop: hasInviteInUrl ? 0 : 12 }}>{t("landing.join.roomId")}</label>
            <input
              id="landing-join-room-id"
              className="input"
              value={joinRoomId}
              onChange={(e) => setJoinRoomId(e.target.value)}
              required
              readOnly={hasInviteInUrl}
            />

            <label className="section-label" htmlFor="landing-join-invite-token" style={{ marginTop: 12 }}>{t("landing.join.inviteToken")}</label>
            <input
              id="landing-join-invite-token"
              className="input"
              value={inviteToken}
              onChange={(e) => setInviteToken(e.target.value)}
              required
              readOnly={hasInviteInUrl}
            />

            <label className="section-label" htmlFor="landing-join-display-name" style={{ marginTop: 12 }}>{t("landing.join.displayName")}</label>
            <input
              id="landing-join-display-name"
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />

            <button
              type="submit"
              className="btn btn-primary"
              disabled={!joinValid || loading}
              style={{ marginTop: 16 }}
            >
              {t("landing.join.cta")}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
