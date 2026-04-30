import { useCallback, useState } from "react";
import type { AgentView, ParticipantView, ClaudeSessionCatalogView, ClaudeSessionSelectionView, ClaudeSessionPreviewView, ClaudeRuntimeStatusView, JoinRequestView } from "../room-state.js";
import { useT } from "../i18n/useT.js";
import { SoundIcon } from "./RoomIcons.js";
import { ClaudeSessionPicker } from "./ClaudeSessionPicker.js";
import { ClaudeStatusCard } from "./ClaudeStatusCard.js";

export interface RoomControlCenterProps {
  open: boolean;
  onClose: () => void;
  soundEnabled: boolean;
  soundVolume: number;
  onSoundEnabledChange: (enabled: boolean) => void;
  onSoundVolumeChange: (volume: number) => void;
  onTestSound: () => void;
  agents: AgentView[];
  activeAgentId?: string;
  participants: ParticipantView[];
  inviteCount: number;
  isOwner: boolean;
  roomId: string;
  onLeaveRoom: () => void;
  onCreateInvite: (role: string, ttl: number) => Promise<string | undefined>;
  onSelectAgent: (agentId: string) => void;
  onRemoveParticipant: (participantId: string) => void;
  onClearRoom: () => void;
  joinRequests: JoinRequestView[];
  onApproveJoinRequest: (requestId: string) => void;
  onRejectJoinRequest: (requestId: string) => void;
  createdInvite?: { url: string; role: string; ttl: number };
  cloudMode?: boolean;
  createdPairing?: { connection_code: string; download_url: string; expires_at: string };
  canManageRoom: boolean;
  claudeSessionCatalog?: ClaudeSessionCatalogView;
  claudeSessionSelection?: ClaudeSessionSelectionView;
  claudeSessionPreviews: ClaudeSessionPreviewView[];
  claudeRuntimeStatuses: ClaudeRuntimeStatusView[];
  serverUrl: string;
  roomSessionToken: string;
  roomSessionParticipantId: string;
  onRequestClaudeSessionPreview?: (sessionId: string) => Promise<void>;
  onSelectClaudeSession?: (selection: { mode: "fresh" } | { mode: "resume"; sessionId: string }) => Promise<void>;
}

type ControlSection = "agent" | "people" | "invite" | "room" | "sound" | "advanced";

function maskConnectionCode(code: string): string {
  if (code.length <= 8) return "••••" + code.slice(-4);
  return code.slice(0, 4) + "••••" + code.slice(-4);
}

function maskInviteUrl(url: string): string {
  try {
    const u = new URL(url);
    const token = u.searchParams.get("token");
    if (!token) return url;
    const masked = token.length > 8 ? token.slice(0, 4) + "••••" + token.slice(-4) : "••••" + token.slice(-4);
    return url.replace(token, masked);
  } catch {
    return url;
  }
}

const dateTimeFormat = new Intl.DateTimeFormat(typeof navigator !== "undefined" ? navigator.language : "en", {
  dateStyle: "medium",
  timeStyle: "short"
});

export function RoomControlCenter(props: RoomControlCenterProps) {
  const t = useT();
  const [section, setSection] = useState<ControlSection>("agent");
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [connectorCopied, setConnectorCopied] = useState(false);
  const [inviteRevealed, setInviteRevealed] = useState(false);
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteTtl, setInviteTtl] = useState(3600);

  const handleCopyConnector = useCallback(() => {
    if (props.createdPairing) {
      navigator.clipboard.writeText(props.createdPairing.connection_code).then(() => {
        setConnectorCopied(true);
        window.setTimeout(() => setConnectorCopied(false), 2000);
      }).catch(() => {});
    }
  }, [props.createdPairing]);

  const handleCreateInvite = useCallback(async () => {
    const url = await props.onCreateInvite(inviteRole, inviteTtl);
    if (url && typeof navigator !== "undefined") {
      await navigator.clipboard.writeText(url).catch(() => {});
    }
  }, [props.onCreateInvite, inviteRole, inviteTtl]);

  const activeAgent = props.agents.find((agent) => agent.agent_id === props.activeAgentId);
  if (!props.open) return null;

  const sections: Array<{ id: ControlSection; label: string }> = [
    { id: "agent", label: t("sidebar.agentLabel") },
    { id: "people", label: t("sidebar.peopleLabel") },
    { id: "invite", label: t("sidebar.inviteLabel") },
    { id: "room", label: t("room.settings") },
    { id: "sound", label: t("room.sound") },
    { id: "advanced", label: t("sidebar.logsLink") }
  ];

  return (
    <div className="room-control-overlay" onClick={props.onClose}>
      <section className="room-control-center" role="dialog" aria-modal="true" aria-label={t("room.controlCenter")} onClick={(event) => event.stopPropagation()}>
        <header className="room-control-center__header">
          <div>
            <p className="section-label">CACP</p>
            <h2>{t("room.controlCenter")}</h2>
          </div>
          <button type="button" className="room-icon-button" onClick={props.onClose} aria-label={t("sidebar.close")}>×</button>
        </header>
        <nav className="room-control-center__tabs" aria-label={t("room.controls")}>
          {sections.map((item) => (
            <button key={item.id} type="button" className={section === item.id ? "is-active" : ""} onClick={() => setSection(item.id)} aria-label={item.label}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="room-control-center__body">
          {section === "agent" && (
            <section className="agent-cockpit">
              <h3>{activeAgent?.name ?? t("sidebar.noActiveAgent")}</h3>
              <p>{activeAgent ? `${activeAgent.status} · ${activeAgent.capabilities.join(" · ") || t("sidebar.noCapabilities")}` : t("sidebar.selectAgent")}</p>
              {props.agents.length > 1 ? (
                <select
                  className="input"
                  value={props.activeAgentId ?? ""}
                  onChange={(event) => props.onSelectAgent(event.target.value)}
                  aria-label={t("sidebar.selectAgent")}
                >
                  {props.agents.map((agent) => <option key={agent.agent_id} value={agent.agent_id}>{agent.name}</option>)}
                </select>
              ) : null}

              <ClaudeSessionPicker
                canManageRoom={props.canManageRoom}
                agentId={props.activeAgentId ?? ""}
                catalog={props.claudeSessionCatalog}
                selection={props.claudeSessionSelection}
                previews={props.claudeSessionPreviews}
                onRequestPreview={props.onRequestClaudeSessionPreview}
                onSelect={props.onSelectClaudeSession ?? (async () => {})}
              />
              {props.claudeRuntimeStatuses.map((status) => (
                <ClaudeStatusCard key={status.status_id} status={status} />
              ))}
            </section>
          )}
          {section === "people" && (
            <section>
              <h3>{t("sidebar.peopleLabel")}</h3>
              {props.participants.map((participant) => (
                <div key={participant.id} className="people-row">
                  <span>{participant.display_name} · {t(`role.${participant.role}` as Parameters<typeof t>[0]) ?? participant.role}</span>
                  {props.isOwner && participant.role !== "owner" ? (
                    <button type="button" className="btn btn-ghost" onClick={() => props.onRemoveParticipant(participant.id)}>{t("sidebar.removeParticipant")}</button>
                  ) : null}
                </div>
              ))}
              {props.isOwner && props.joinRequests.length > 0 ? (
                <div style={{ marginTop: 16 }}>
                  <div className="sidebar-card-title-row" style={{ marginBottom: 8 }}>
                    <span className="section-label">{t("sidebar.joinRequestsLabel")}</span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--ink-4)",
                        background: "var(--surface-warm)",
                        border: "1px solid var(--border-soft)",
                        borderRadius: "var(--radius-chip)",
                        padding: "2px 8px",
                      }}
                    >
                      {props.joinRequests.length}
                    </span>
                  </div>
                  {props.joinRequests.map((req) => (
                    <div key={req.request_id} className="people-row">
                      <span style={{ fontSize: 13 }}>{req.display_name}</span>
                      <span style={{ display: "flex", gap: 4 }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ padding: "2px 8px", fontSize: 11 }}
                          onClick={() => props.onApproveJoinRequest(req.request_id)}
                        >
                          {t("sidebar.approve")}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: "2px 8px", fontSize: 11 }}
                          onClick={() => props.onRejectJoinRequest(req.request_id)}
                        >
                          {t("sidebar.reject")}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          )}
          {section === "invite" && (
            <section>
              <h3>{t("sidebar.inviteLabel")}</h3>
              <p>{t("sidebar.inviteCount", { count: props.inviteCount })}</p>
              {props.canManageRoom ? (
                <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                  <select
                    className="input"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    aria-label={t("role.label")}
                    style={{ fontSize: 12, padding: "6px 8px", minWidth: 100 }}
                  >
                    <option value="member">{t("role.member")}</option>
                    <option value="observer">{t("role.observer")}</option>
                  </select>
                  <select
                    className="input"
                    value={inviteTtl}
                    onChange={(e) => setInviteTtl(Number(e.target.value))}
                    aria-label={t("sidebar.ttlLabel")}
                    style={{ fontSize: 12, padding: "6px 8px", minWidth: 100 }}
                  >
                    <option value={3600}>{t("sidebar.ttl1h")}</option>
                    <option value={86400}>{t("sidebar.ttl24h")}</option>
                    <option value={604800}>{t("sidebar.ttl7d")}</option>
                  </select>
                  <button type="button" className="btn btn-warm" style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => void handleCreateInvite()} aria-label={t("sidebar.createAndCopyInvite")}>
                    {t("sidebar.copyInvite")}
                  </button>
                </div>
              ) : (
                <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8 }}>{t("sidebar.inviteOwnerOnly")}</p>
              )}
              {props.createdInvite ? (
                <div style={{ marginTop: 8 }}>
                  <code
                    style={{
                      display: "block",
                      fontSize: 11,
                      wordBreak: "break-all",
                      padding: 8,
                      background: "var(--surface-warm)",
                      border: "1px solid var(--border-soft)",
                      borderRadius: "var(--radius-chip)",
                      color: "var(--ink-2)",
                    }}
                  >
                    {inviteRevealed ? props.createdInvite.url : maskInviteUrl(props.createdInvite.url)}
                  </code>
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 8px" }} onClick={() => setInviteRevealed((v) => !v)}>
                      {t("sidebar.revealInvite")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 11, padding: "4px 8px" }}
                      aria-label={t("sidebar.copyInviteLink")}
                      onClick={() => navigator.clipboard.writeText(props.createdInvite!.url).catch(() => {})}
                    >
                      {t("sidebar.copyInvite")}
                    </button>
                  </div>
                </div>
              ) : null}

              {props.cloudMode && props.isOwner && props.createdPairing ? (
                <div style={{ marginTop: 16 }}>
                  <h4>{t("sidebar.connectorLabel")}</h4>
                  <a
                    className="btn btn-warm"
                    style={{ display: "block", textAlign: "center", marginBottom: 10, textDecoration: "none" }}
                    href={props.createdPairing.download_url}
                    download
                  >
                    {t("sidebar.downloadConnector")}
                  </a>
                  <code
                    style={{
                      display: "block",
                      marginBottom: 8,
                      padding: 8,
                      fontSize: 11,
                      background: "var(--surface-warm)",
                      border: "1px solid var(--border-soft)",
                      borderRadius: "var(--radius-chip)",
                      color: "var(--ink-2)",
                    }}
                  >
                    <span style={{ display: "block", marginBottom: 4, color: "var(--ink-4)" }}>
                      {t("sidebar.connectionCodePreview")}
                    </span>
                    {maskConnectionCode(props.createdPairing.connection_code)}
                  </code>
                  <p style={{ fontSize: 11, color: "var(--ink-3)", margin: "0 0 8px" }}>
                    {t("sidebar.connectorHelp", { expiresAt: dateTimeFormat.format(new Date(props.createdPairing.expires_at)) })}
                  </p>
                  <button
                    type="button"
                    className="btn btn-warm"
                    style={{ width: "100%" }}
                    onClick={handleCopyConnector}
                  >
                    {connectorCopied ? t("sidebar.connectionCodeCopied") : t("sidebar.copyConnectionCode")}
                  </button>
                </div>
              ) : null}
            </section>
          )}
          {section === "room" && (
            <section>
              <h3>{t("room.settings")}</h3>
              <p>{props.roomId}</p>
              <button type="button" className="btn btn-ghost" onClick={props.onLeaveRoom}>{t("room.leave")}</button>
              {props.isOwner ? (
                confirmingClear ? (
                  <div className="composer-confirm-clear" style={{ marginTop: 8 }}>
                    <p>{t("composer.clearConversationConfirm")}</p>
                    <button type="button" className="btn btn-warm" onClick={() => { setConfirmingClear(false); props.onClearRoom(); }}>
                      {t("composer.clearConversationConfirmAction")}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setConfirmingClear(false)}>
                      {t("common.cancel")}
                    </button>
                  </div>
                ) : (
                  <button type="button" className="btn btn-warm-ghost" onClick={() => setConfirmingClear(true)}>
                    {t("composer.clearConversation")}
                  </button>
                )
              ) : null}
            </section>
          )}
          {section === "sound" && (
            <section>
              <h3><SoundIcon /> {t("room.sound")}</h3>
              <button type="button" role="switch" aria-checked={props.soundEnabled} onClick={() => props.onSoundEnabledChange(!props.soundEnabled)}>
                {t("room.soundCues")}
              </button>
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <label htmlFor="sound-volume" style={{ fontSize: 12, color: "var(--ink-3)" }}>{t("room.soundVolume")}</label>
                <input
                  id="sound-volume"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={props.soundVolume}
                  onChange={(e) => props.onSoundVolumeChange(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 12, color: "var(--ink-3)", minWidth: 36, textAlign: "right" }}>{Math.round(props.soundVolume * 100)}%</span>
              </div>
              <button type="button" className="btn btn-ghost" onClick={props.onTestSound} style={{ marginTop: 8 }}>{t("room.testSound")}</button>
            </section>
          )}
          {section === "advanced" && (
            <section>
              <h3>{t("sidebar.logsLink")}</h3>
              <p>{t("sidebar.placeholderBody")}</p>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
