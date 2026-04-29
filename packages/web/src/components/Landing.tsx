import { useContext, useEffect, useMemo, useState } from "react";
import { parseInviteUrl } from "../api.js";
import { LangContext } from "../i18n/LangProvider.js";
import { useT } from "../i18n/useT.js";
import { isCloudMode } from "../runtime-config.js";
import CacpHeroLogo from "./CacpHeroLogo.js";

interface LandingProps {
  onCreate: (params: { roomName: string; displayName: string; agentType: string; permissionLevel: string }) => void;
  onJoin: (params: { roomId: string; inviteToken: string; displayName: string }) => void;
  loading?: boolean;
}

const commandAgentTypes = [
  { value: "claude-code", labelKey: "agentType.claudeCode" }
] as const;

const llmAgentTypes = [
  { value: "llm-api", labelKey: "agentType.llmApi" },
  { value: "llm-openai-compatible", labelKey: "agentType.llmOpenAiCompatible" },
  { value: "llm-anthropic-compatible", labelKey: "agentType.llmAnthropicCompatible" }
] as const;
const llmAgentTypeValues = new Set<string>(llmAgentTypes.map((item) => item.value));

const permissionLevels = [
  { value: "read_only", labelKey: "permission.readOnly" },
  { value: "limited_write", labelKey: "permission.limitedWrite" },
  { value: "full_access", labelKey: "permission.fullAccess" }
] as const;

const valueTags = [
  { labelKey: "landing.value.local" },
  { labelKey: "landing.value.room" },
  { labelKey: "landing.value.governed" }
] as const;

export default function Landing({ onCreate, onJoin, loading }: LandingProps) {
  const t = useT();
  const langCtx = useContext(LangContext);

  const inviteTarget = useMemo(() => parseInviteUrl(window.location.search) ?? parseInviteUrl(window.location.hash.replace(/^#/, "?")), []);
  const hasInviteInUrl = Boolean(inviteTarget);

  const [roomName, setRoomName] = useState("CACP AI Room");
  const [ownerDisplayName, setOwnerDisplayName] = useState("");
  const [joinDisplayName, setJoinDisplayName] = useState("");
  const [agentType, setAgentType] = useState("claude-code");
  const [permissionLevel, setPermissionLevel] = useState("read_only");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const selectedLlmApiAgent = llmAgentTypeValues.has(agentType);
  const createValid = roomName.trim() && ownerDisplayName.trim();
  const joinValid = Boolean(inviteTarget && joinDisplayName.trim());

  useEffect(() => {
    if (hasInviteInUrl) setAdvancedOpen(false);
  }, [hasInviteInUrl]);

  function handleCreateSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!createValid || loading) return;
    onCreate({
      roomName: roomName.trim(),
      displayName: ownerDisplayName.trim(),
      agentType,
      permissionLevel: selectedLlmApiAgent ? "read_only" : permissionLevel
    });
  }

  function handleJoinSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!joinValid || loading || !inviteTarget) return;
    onJoin({
      roomId: inviteTarget.room_id,
      inviteToken: inviteTarget.invite_token,
      displayName: joinDisplayName.trim()
    });
  }

  return (
    <main className={`landing-shell ${hasInviteInUrl ? "landing-shell-invite" : ""}`}>
      <div className="landing-orb landing-orb-primary" aria-hidden="true" />
      <div className="landing-orb landing-orb-secondary" aria-hidden="true" />

      <div className="landing-topbar">
        <div className="landing-mini-brand" aria-label={t("landing.brand")}>
          <span className="landing-mini-mark">C</span>
          <span>{t("landing.brand")}</span>
        </div>
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

      <section className="landing-hero-grid">
        <div className="landing-showcase">
          <p className="landing-eyebrow">{t("landing.eyebrow")}</p>
          <CacpHeroLogo />
          <h1 className="landing-headline">{t("landing.headline")}</h1>
          <p className="landing-subcopy">{t("landing.subcopy")}</p>
          <div className="landing-value-tags" aria-label="CACP values">
            {valueTags.map((item) => (
              <span key={item.labelKey} className="landing-value-tag">{t(item.labelKey)}</span>
            ))}
          </div>
        </div>

        <article className="landing-card landing-console" aria-labelledby={hasInviteInUrl ? "landing-invite-title" : "landing-create-title"}>
          {hasInviteInUrl && inviteTarget ? (
            <form data-testid="landing-invite-card" className="landing-form" onSubmit={handleJoinSubmit}>
              <p className="landing-console-kicker">{t("landing.tab.join")}</p>
              <h2 id="landing-invite-title" className="landing-console-title">{t("landing.join.cardTitle")}</h2>
              <p className="landing-console-copy">{t("landing.join.cardSubcopy")}</p>

              <label className="section-label" htmlFor="landing-join-display-name">{t("landing.join.displayName")}</label>
              <input
                id="landing-join-display-name"
                className="input landing-input"
                value={joinDisplayName}
                onChange={(e) => setJoinDisplayName(e.target.value)}
                required
                autoComplete="name"
              />

              <p className="landing-room-hint">{t("landing.join.invitedRoom", { roomId: inviteTarget.room_id })}</p>

              <button type="submit" className="btn btn-primary landing-primary-action" disabled={!joinValid || loading}>
                {t("landing.join.cta")}
              </button>
            </form>
          ) : (
            <form data-testid="landing-create-card" className="landing-form" onSubmit={handleCreateSubmit}>
              <p className="landing-console-kicker">{t("room.create")}</p>
              <h2 id="landing-create-title" className="landing-console-title">{t("landing.create.cardTitle")}</h2>
              <p className="landing-console-copy">{t("landing.create.cardSubcopy")}</p>

              <label className="section-label" htmlFor="landing-display-name">{t("landing.create.displayName")}</label>
              <input
                id="landing-display-name"
                className="input landing-input"
                value={ownerDisplayName}
                onChange={(e) => setOwnerDisplayName(e.target.value)}
                required
                autoComplete="name"
              />

              <label className="section-label" htmlFor="landing-room-name">{t("landing.create.roomName")}</label>
              <input
                id="landing-room-name"
                className="input landing-input"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                required
              />

              <button
                type="button"
                className="landing-advanced-toggle"
                aria-expanded={advancedOpen}
                aria-controls="landing-advanced-options"
                onClick={() => setAdvancedOpen((open) => !open)}
              >
                <span>{advancedOpen ? t("landing.create.advancedHide") : t("landing.create.advancedToggle")}</span>
                <span aria-hidden="true">{advancedOpen ? "−" : "+"}</span>
              </button>

              <div id="landing-advanced-options" className="landing-advanced" hidden={!advancedOpen}>
                <p className="section-label">{t("landing.create.advancedTitle")}</p>

                <label className="section-label" htmlFor="landing-agent-type">{t("landing.create.agentType")}</label>
                <select
                  id="landing-agent-type"
                  className="input landing-input"
                  value={agentType}
                  onChange={(e) => setAgentType(e.target.value)}
                >
                  <optgroup label={t("agentType.group.localCommand")}>
                    {commandAgentTypes.map((item) => <option key={item.value} value={item.value}>{t(item.labelKey)}</option>)}
                  </optgroup>
                  <optgroup label={t("agentType.group.llmApi")}>
                    {llmAgentTypes.map((item) => <option key={item.value} value={item.value}>{t(item.labelKey)}</option>)}
                  </optgroup>
                </select>

                {!selectedLlmApiAgent && (
                  <>
                    <label className="section-label" htmlFor="landing-permission-level">{t("landing.create.permissionLevel")}</label>
                    <select
                      id="landing-permission-level"
                      className="input landing-input"
                      value={permissionLevel}
                      onChange={(e) => setPermissionLevel(e.target.value)}
                    >
                      {permissionLevels.map((item) => (
                        <option key={item.value} value={item.value}>{t(item.labelKey)}</option>
                      ))}
                    </select>
                  </>
                )}

                {selectedLlmApiAgent && (
                  <p className="landing-safe-copy">{t("landing.create.llmApiKeyLocalOnly")}</p>
                )}

                {isCloudMode() && (
                  <div className="connector-setup landing-connector-setup">
                    <a className="btn btn-ghost" href="/downloads/CACP-Local-Connector.exe" download>
                      {t("landing.connector.download")}
                    </a>
                    <p className="landing-safe-copy">
                      {selectedLlmApiAgent ? t("landing.connector.llmInstructions") : t("landing.connector.instructions")}
                    </p>
                  </div>
                )}
              </div>

              <button
                type="submit"
                className="btn btn-warm landing-primary-action"
                disabled={!createValid || loading}
              >
                {isCloudMode() ? t("landing.create.cloudCta") : t("landing.create.cta")}
              </button>
              {isCloudMode() && (
                <p className="landing-safe-copy landing-cloud-hint">{t("landing.create.cloudAgentHint")}</p>
              )}
            </form>
          )}
        </article>
      </section>

      <footer className="landing-footer">
        <span>{t("landing.footer.copyright")}</span>
        <span>{t("landing.footer.contact")}</span>
      </footer>
    </main>
  );
}
