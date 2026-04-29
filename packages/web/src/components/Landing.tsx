import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { parseInviteUrl } from "../api.js";
import { LangContext } from "../i18n/LangProvider.js";
import { useT } from "../i18n/useT.js";
import { isCloudMode } from "../runtime-config.js";
import CacpHeroLogo from "./CacpHeroLogo.js";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

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
  {
    labelKey: "landing.value.local",
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    )
  },
  {
    labelKey: "landing.value.room",
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
        <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
      </svg>
    )
  },
  {
    labelKey: "landing.value.governed",
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    )
  }
] as const;

export default function Landing({ onCreate, onJoin, loading }: LandingProps) {
  const t = useT();
  const langCtx = useContext(LangContext);
  const heroRef = useRef<HTMLElement>(null);

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

  useLayoutEffect(() => {
    const hero = heroRef.current;
    if (!hero || prefersReducedMotion()) return;

    const ctx = gsap.context(() => {
      gsap.set(".landing-headline, .landing-subcopy, .landing-value-tag, .landing-console", {
        opacity: 0,
        y: 16,
      });

      const tl = gsap.timeline({ defaults: { ease: "power2.out" }, delay: 0.4 });
      tl.to(".landing-headline", { opacity: 1, y: 0, duration: 0.55 })
        .to(".landing-subcopy", { opacity: 1, y: 0, duration: 0.5 }, "-=0.3")
        .to(".landing-value-tag", { opacity: 1, y: 0, duration: 0.4, stagger: 0.08 }, "-=0.25")
        .to(".landing-console", { opacity: 1, y: 0, duration: 0.6 }, "-=0.5");
    }, hero);

    return () => ctx.revert();
  }, []);

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
        <button
          type="button"
          className="lang-toggle"
          onClick={() => langCtx?.setLang(langCtx.lang === "en" ? "zh" : "en")}
          title={t("lang.toggle")}
          aria-label={t("lang.toggle")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M2 12h20" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <span aria-hidden="true">{langCtx?.lang === "zh" ? "EN" : "ZH"}</span>
        </button>
      </div>

      <section ref={heroRef} className="landing-hero-grid">
        <div className="landing-showcase">
          <p className="landing-eyebrow">{t("landing.eyebrow")}</p>
          <CacpHeroLogo ariaLabel={t("landing.logoLabel")} />
          <h1 className="landing-headline">{t("landing.headline")}</h1>
          <p className="landing-subcopy">{t("landing.subcopy")}</p>
          <div className="landing-value-tags" aria-label={t("landing.valuesLabel")}>
            {valueTags.map((item) => (
              <span key={item.labelKey} className="landing-value-tag">
                {item.icon}
                {t(item.labelKey)}
              </span>
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

              <div
                id="landing-advanced-options"
                className={`landing-advanced ${advancedOpen ? "is-open" : ""}`}
                aria-hidden={advancedOpen ? undefined : true}
                inert={advancedOpen ? undefined : true}
              >
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
