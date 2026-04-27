import { useState, useCallback } from "react";
import { useT } from "../i18n/useT.js";
import type { AgentView, ParticipantView } from "../room-state.js";

import type { JoinRequestView } from "../room-state.js";

export interface SidebarProps {
  agents: AgentView[];
  activeAgentId?: string;
  participants: ParticipantView[];
  inviteCount: number;
  joinRequests: JoinRequestView[];
  isOwner: boolean;
  canManageRoom: boolean;
  currentParticipantId?: string;
  onSelectAgent: (agentId: string) => void;
  onCreateInvite: (role: string, ttl: number) => Promise<string | undefined>;
  onApproveJoinRequest: (requestId: string) => void;
  onRejectJoinRequest: (requestId: string) => void;
  onRemoveParticipant: (participantId: string) => void;
  createdInvite?: { url: string; role: string; ttl: number };
  cloudMode?: boolean;
  createdPairing?: { connection_code: string; download_url: string; expires_at: string };
}

function agentAvatarInitial(name: string): string {
  const map: Record<string, string> = {
    "Claude Code": "C",
    "Codex": "X",
    "opencode": "O",
    "Echo": "E",
  };
  return map[name] ?? name.charAt(0).toUpperCase();
}

function formatLastSeen(iso: string | undefined, t: ReturnType<typeof useT>): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = Math.floor((now - then) / 60000);
  if (diffMin < 1) return t("sidebar.lastSeen.justNow");
  if (diffMin < 60) return t("sidebar.lastSeen.minutes", { count: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return t("sidebar.lastSeen.hours", { count: diffHour });
  const diffDay = Math.floor(diffHour / 24);
  return t("sidebar.lastSeen.days", { count: diffDay });
}

function roleClass(role: string): string {
  return role === "owner" ? "people-role owner" : "people-role other";
}

function roleDisplay(role: string, t: ReturnType<typeof useT>): string {
  switch (role) {
    case "owner": return t("role.owner");
    case "admin": return t("role.admin");
    case "member": return t("role.member");
    case "observer": return t("role.observer");
    default: return role;
  }
}

export function maskConnectionCode(code: string): string {
  if (code.length <= 12) return `••••${code}`;
  const parts = code.split(":");
  const prefix = parts.length >= 2 ? parts.slice(0, 2).join(":") : code.slice(0, 8);
  return `${prefix}:••••••••${code.slice(-6)}`;
}

function PlaceholderDialog({ title, onClose }: { title: string; onClose: () => void }) {
  const t = useT();
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(28, 24, 19, 0.25)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)",
          padding: 24,
          maxWidth: 360,
          width: "90%",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>{title}</h3>
        <p style={{ margin: "0 0 16px", color: "var(--ink-3)" }}>{t("sidebar.placeholderBody")}</p>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t("sidebar.close")}
        </button>
      </div>
    </div>
  );
}

export default function Sidebar({
  agents,
  activeAgentId,
  participants,
  inviteCount,
  joinRequests,
  isOwner,
  canManageRoom,
  currentParticipantId,
  onSelectAgent,
  onCreateInvite,
  onApproveJoinRequest,
  onRejectJoinRequest,
  onRemoveParticipant,
  createdInvite,
  cloudMode,
  createdPairing,
}: SidebarProps) {
  const t = useT();
  const [dialog, setDialog] = useState<{ title: string } | null>(null);
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteTtl, setInviteTtl] = useState(3600);
  const [connectorCopied, setConnectorCopied] = useState(false);

  const handleCopyConnector = useCallback(() => {
    if (createdPairing) {
      navigator.clipboard.writeText(createdPairing.connection_code).then(() => {
        setConnectorCopied(true);
        window.setTimeout(() => setConnectorCopied(false), 2000);
      }).catch(() => {});
    }
  }, [createdPairing]);

  const activeAgent = agents.find((a) => a.agent_id === activeAgentId);

  const openPlaceholder = useCallback((title: string) => {
    setDialog({ title });
  }, []);

  const closeDialog = useCallback(() => {
    setDialog(null);
  }, []);

  const handleCopyInvite = useCallback(() => {
    void onCreateInvite(inviteRole, inviteTtl).then((url) => {
      if (url) {
        navigator.clipboard.writeText(url).catch(() => {});
      }
    });
  }, [onCreateInvite, inviteRole, inviteTtl]);

  return (
    <>
      <aside className="sidebar">
        {/* Agent card */}
        <div className="card card-warm">
          <div className="sidebar-card-title-row">
            <span className="section-label">{t("sidebar.agentLabel")}</span>
            {isOwner && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: "4px 8px", fontSize: 11 }}
                onClick={() => openPlaceholder(t("sidebar.agentLogsTitle"))}
              >
                {t("sidebar.logsLink")} →
              </button>
            )}
          </div>

          {activeAgent ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }} aria-label={`Active agent ${activeAgent.name}`}>
                <div className="agent-avatar">{agentAvatarInitial(activeAgent.name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{activeAgent.name}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-4)", display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      className={activeAgent.status === "online" ? "status-dot online" : "status-dot"}
                    />
                    {activeAgent.status === "online"
                      ? t("agent.status.online")
                      : t("agent.status.offline")}
                    {activeAgent.last_status_at && activeAgent.status !== "online" && (
                      <span>· {formatLastSeen(activeAgent.last_status_at, t)}</span>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {activeAgent.capabilities.map((cap) => (
                  <span key={cap} className="permission-tag">{cap}</span>
                ))}
                {activeAgent.capabilities.length === 0 && (
                  <span className="permission-tag">{t("sidebar.noCapabilities")}</span>
                )}
              </div>

              {isOwner && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: "4px 8px", fontSize: 11 }}
                    onClick={() => openPlaceholder(t("sidebar.restartAgentTitle"))}
                  >
                    {t("sidebar.restart")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: "4px 8px", fontSize: 11 }}
                    onClick={() => openPlaceholder(t("sidebar.changePermissionTitle"))}
                  >
                    {t("sidebar.changePermission")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: "4px 8px", fontSize: 11, color: "var(--danger)" }}
                    onClick={() => onRemoveParticipant(activeAgent.agent_id)}
                    title={t("sidebar.removeAgent")}
                  >
                    {t("sidebar.removeAgent")}
                  </button>
                </div>
              )}
            </>
          ) : (
            <p style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("sidebar.noActiveAgent")}</p>
          )}

          <select
            className="input"
            style={{ marginTop: 10 }}
            value={activeAgentId ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              if (value) onSelectAgent(value);
            }}
            disabled={!canManageRoom || agents.length === 0}
          >
            <option value="">{t("sidebar.selectAgent")}</option>
            {agents.map((agent) => (
              <option key={agent.agent_id} value={agent.agent_id}>
                {agent.status === "online" ? t("agent.status.online") : t("agent.status.offline")} · {agent.name}
              </option>
            ))}
          </select>
        </div>

        {/* People card */}
        <div className="card">
          <div className="sidebar-card-title-row">
            <span className="section-label">{t("sidebar.peopleLabel")}</span>
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
              {participants.length}
            </span>
          </div>

          {participants.map((p) => (
            <div key={p.id} className="people-row">
              <span style={{ fontSize: 13 }}>
                {p.display_name}
                {p.id === currentParticipantId && (
                  <span style={{ color: "var(--ink-4)", marginLeft: 4 }}>{t("sidebar.you")}</span>
                )}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className={roleClass(p.role)}>{roleDisplay(p.role, t)}</span>
                {isOwner && p.role !== "owner" && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: "2px 6px", fontSize: 11, color: "var(--ink-4)" }}
                    onClick={() => onRemoveParticipant(p.id)}
                    title={t("sidebar.removeParticipant")}
                  >
                    ×
                  </button>
                )}
              </span>
            </div>
          ))}

          {participants.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("sidebar.noPeople")}</p>
          )}
        </div>

        {/* Join requests card (owner-only) */}
        {isOwner && joinRequests.length > 0 && (
          <div className="card">
            <div className="sidebar-card-title-row">
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
                {joinRequests.length}
              </span>
            </div>

            {joinRequests.map((req) => (
              <div key={req.request_id} className="people-row">
                <span style={{ fontSize: 13 }}>{req.display_name}</span>
                <span style={{ display: "flex", gap: 4 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: "2px 8px", fontSize: 11 }}
                    onClick={() => onApproveJoinRequest(req.request_id)}
                  >
                    {t("sidebar.approve")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: "2px 8px", fontSize: 11 }}
                    onClick={() => onRejectJoinRequest(req.request_id)}
                  >
                    {t("sidebar.reject")}
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Invite card (owner-only) */}
        {isOwner && (
          <div className="card">
            <div className="sidebar-card-title-row">
              <span className="section-label">{t("sidebar.inviteLabel")}</span>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: "4px 8px", fontSize: 11 }}
                onClick={() => openPlaceholder(t("sidebar.inviteHistoryTitle"))}
              >
                {t("sidebar.historyLink")} →
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
              <select
                className="input"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
              >
                <option value="member">{t("role.member")}</option>
                <option value="observer">{t("role.observer")}</option>
              </select>
              <select
                className="input"
                value={inviteTtl}
                onChange={(e) => setInviteTtl(Number(e.target.value))}
              >
                <option value={3600}>{t("sidebar.ttl1h")}</option>
                <option value={86400}>{t("sidebar.ttl24h")}</option>
                <option value={604800}>{t("sidebar.ttl7d")}</option>
              </select>
            </div>

            <button
              type="button"
              className="btn btn-warm"
              style={{ width: "100%" }}
              onClick={handleCopyInvite}
            >
              {t("sidebar.copyInvite")}
            </button>

            {createdInvite && (
              <code
                style={{
                  display: "block",
                  marginTop: 8,
                  fontSize: 11,
                  wordBreak: "break-all",
                  padding: 8,
                  background: "var(--surface-warm)",
                  border: "1px solid var(--border-soft)",
                  borderRadius: "var(--radius-chip)",
                  color: "var(--ink-2)",
                }}
              >
                {createdInvite.url}
              </code>
            )}

            <div
              style={{
                marginTop: 8,
                fontSize: 11,
                color: "var(--ink-4)",
                textAlign: "right",
              }}
            >
              {t("sidebar.inviteCount", { count: inviteCount })}
            </div>
          </div>
        )}

        {/* Local Connector card (cloud mode, owner-only) */}
        {cloudMode && isOwner && createdPairing && (
          <div className="card">
            <div className="sidebar-card-title-row">
              <span className="section-label">{t("sidebar.connectorLabel")}</span>
            </div>

            <a
              className="btn btn-warm"
              style={{ display: "block", textAlign: "center", marginBottom: 10, textDecoration: "none" }}
              href={createdPairing.download_url}
              download
            >
              {t("sidebar.downloadConnector")}
            </a>

            <code
              style={{
                display: "block",
                marginBottom: 10,
                fontSize: 11,
                wordBreak: "break-all",
                padding: 8,
                background: "var(--surface-warm)",
                border: "1px solid var(--border-soft)",
                borderRadius: "var(--radius-chip)",
                color: "var(--ink-2)",
              }}
            >
              <span style={{ display: "block", marginBottom: 4, color: "var(--ink-4)" }}>
                {t("sidebar.connectionCodePreview")}
              </span>
              {maskConnectionCode(createdPairing.connection_code)}
            </code>

            <p style={{ fontSize: 11, color: "var(--ink-3)", margin: "0 0 8px" }}>
              {t("sidebar.connectorHelp", { expiresAt: new Date(createdPairing.expires_at).toLocaleString() })}
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
        )}
      </aside>

      {dialog && <PlaceholderDialog title={dialog.title} onClose={closeDialog} />}
    </>
  );
}
