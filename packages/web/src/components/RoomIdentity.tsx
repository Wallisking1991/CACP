import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT.js";
import { LinkIcon, CopyIcon, InviteIcon } from "./RoomIcons.js";
import type { InviteView } from "../room-state.js";

export interface RoomIdentityProps {
  roomName: string;
  roomId: string;
  userDisplayName?: string;
  userRole?: string;
  isOwner?: boolean;
  onCopyRoomId: (roomId: string) => void;
  onCreatePairing?: (agentType: string, permissionLevel: string) => Promise<string>;
  onCreateInvite?: (role: string, ttl: number, maxUses: number) => Promise<string | undefined>;
  createdInvite?: { url: string; role: string; ttl: number; max_uses: number };
  invites?: InviteView[];
}

function shortRoomId(roomId: string): string {
  if (roomId.length <= 16) return roomId;
  return `${roomId.slice(0, 9)}…${roomId.slice(-5)}`;
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

const agentTypes = [
  { value: "claude-code", labelKey: "agentType.claudeCode", group: "agentType.group.localCommand" },
  { value: "llm-api", labelKey: "agentType.llmApi", group: "agentType.group.llmApi" },
  { value: "llm-openai-compatible", labelKey: "agentType.llmOpenAiCompatible", group: "agentType.group.llmApi" },
  { value: "llm-anthropic-compatible", labelKey: "agentType.llmAnthropicCompatible", group: "agentType.group.llmApi" },
];

const permissionLevels = [
  { value: "read_only", labelKey: "permission.readOnly" },
  { value: "limited_write", labelKey: "permission.limitedWrite" },
  { value: "full_access", labelKey: "permission.fullAccess" },
];

type ActivePanel = "none" | "invite" | "pairing";

export function RoomIdentity({ roomName, roomId, userDisplayName, userRole, isOwner, onCopyRoomId, onCreatePairing, onCreateInvite, createdInvite, invites = [] }: RoomIdentityProps) {
  const t = useT();
  const roleLabel = userRole ? (t(`role.${userRole}` as Parameters<typeof t>[0]) ?? userRole) : "";
  const userLine = [userDisplayName, roleLabel].filter(Boolean).join(" · ");

  const [activePanel, setActivePanel] = useState<ActivePanel>("none");

  // Pairing panel state
  const [agentType, setAgentType] = useState("claude-code");
  const [permissionLevel, setPermissionLevel] = useState("read_only");
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingCopied, setPairingCopied] = useState(false);
  const [pairingError, setPairingError] = useState<string>("");

  // Invite panel state
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteTtl, setInviteTtl] = useState(3600);
  const [inviteMaxUses, setInviteMaxUses] = useState(1);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteError, setInviteError] = useState<string>("");
  const [inviteRevealed, setInviteRevealed] = useState(false);

  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  const inviteButtonRef = useRef<HTMLButtonElement>(null);
  const pairingButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const activeButtonRef = activePanel === "invite" ? inviteButtonRef : pairingButtonRef;

  useEffect(() => {
    if (activePanel !== "none" && activeButtonRef.current) {
      const rect = activeButtonRef.current.getBoundingClientRect();
      setPanelStyle({
        position: "fixed",
        top: rect.bottom + 6,
        left: rect.left,
      });
    }
  }, [activePanel]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        inviteButtonRef.current && !inviteButtonRef.current.contains(target) &&
        pairingButtonRef.current && !pairingButtonRef.current.contains(target) &&
        panelRef.current && !panelRef.current.contains(target)
      ) {
        setActivePanel("none");
      }
    }
    function handleScroll() {
      if (activePanel !== "none" && activeButtonRef.current) {
        const rect = activeButtonRef.current.getBoundingClientRect();
        setPanelStyle({
          position: "fixed",
          top: rect.bottom + 6,
          left: rect.left,
        });
      }
    }
    if (activePanel !== "none") {
      document.addEventListener("mousedown", handleClickOutside);
      window.addEventListener("scroll", handleScroll, true);
      window.addEventListener("resize", handleScroll);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        window.removeEventListener("scroll", handleScroll, true);
        window.removeEventListener("resize", handleScroll);
      };
    }
  }, [activePanel]);

  const togglePanel = useCallback((panel: ActivePanel) => {
    setActivePanel((prev) => prev === panel ? "none" : panel);
    setPairingError("");
    setInviteError("");
  }, []);

  const handleGeneratePairing = useCallback(async () => {
    if (!onCreatePairing) return;
    setPairingLoading(true);
    setPairingError("");
    try {
      const connectionCode = await onCreatePairing(agentType, permissionLevel);
      await navigator.clipboard.writeText(connectionCode);
      setPairingCopied(true);
      setActivePanel("none");
      window.setTimeout(() => setPairingCopied(false), 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("room.generateError");
      setPairingError(message);
    } finally {
      setPairingLoading(false);
    }
  }, [onCreatePairing, agentType, permissionLevel, t]);

  const handleGenerateInvite = useCallback(async () => {
    if (!onCreateInvite) return;
    setInviteLoading(true);
    setInviteError("");
    try {
      const url = await onCreateInvite(inviteRole, inviteTtl, inviteMaxUses);
      if (url) {
        await navigator.clipboard.writeText(url);
      }
      setInviteCopied(true);
      setActivePanel("none");
      window.setTimeout(() => setInviteCopied(false), 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("room.generateError");
      setInviteError(message);
    } finally {
      setInviteLoading(false);
    }
  }, [onCreateInvite, inviteRole, inviteTtl, inviteMaxUses, t]);

  const panel = activePanel !== "none" ? (
    <div
      ref={panelRef}
      className="connection-code-panel"
      style={panelStyle}
    >
      {activePanel === "pairing" ? (
        <>
          <label className="section-label" htmlFor="conn-code-agent-type">{t("landing.create.agentType")}</label>
          <select
            id="conn-code-agent-type"
            value={agentType}
            onChange={(e) => setAgentType(e.target.value)}
          >
            <optgroup label={t("agentType.group.localCommand")}>
              {agentTypes
                .filter((a) => a.group === "agentType.group.localCommand")
                .map((a) => (
                  <option key={a.value} value={a.value}>
                    {t(a.labelKey as Parameters<typeof t>[0])}
                  </option>
                ))}
            </optgroup>
            <optgroup label={t("agentType.group.llmApi")}>
              {agentTypes
                .filter((a) => a.group === "agentType.group.llmApi")
                .map((a) => (
                  <option key={a.value} value={a.value}>
                    {t(a.labelKey as Parameters<typeof t>[0])}
                  </option>
                ))}
            </optgroup>
          </select>
          <label className="section-label" htmlFor="conn-code-permission">{t("landing.create.permissionLevel")}</label>
          <select
            id="conn-code-permission"
            value={permissionLevel}
            onChange={(e) => setPermissionLevel(e.target.value)}
          >
            {permissionLevels.map((p) => (
              <option key={p.value} value={p.value}>
                {t(p.labelKey as Parameters<typeof t>[0])}
              </option>
            ))}
          </select>
          {pairingError ? (
            <p className="error inline-error" style={{ fontSize: 12, margin: 0 }}>{pairingError}</p>
          ) : null}
          <div className="connection-code-panel-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setActivePanel("none")}
              disabled={pairingLoading}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleGeneratePairing}
              disabled={pairingLoading}
            >
              {pairingLoading ? "…" : t("room.generateAndCopy")}
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="section-label" htmlFor="invite-role">{t("role.label")}</label>
          <select
            id="invite-role"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
          >
            <option value="member">{t("role.member")}</option>
            <option value="observer">{t("role.observer")}</option>
          </select>
          <label className="section-label" htmlFor="invite-ttl">{t("sidebar.ttlLabel")}</label>
          <select
            id="invite-ttl"
            value={inviteTtl}
            onChange={(e) => setInviteTtl(Number(e.target.value))}
          >
            <option value={3600}>{t("sidebar.ttl1h")}</option>
            <option value={86400}>{t("sidebar.ttl24h")}</option>
            <option value={604800}>{t("sidebar.ttl7d")}</option>
          </select>
          <label className="section-label" htmlFor="invite-max-uses">{t("sidebar.maxUsesLabel")}</label>
          <select
            id="invite-max-uses"
            value={inviteMaxUses}
            onChange={(e) => setInviteMaxUses(Number(e.target.value))}
          >
            <option value={1}>{t("sidebar.maxUses1")}</option>
            <option value={5}>{t("sidebar.maxUses5")}</option>
            <option value={10}>{t("sidebar.maxUses10")}</option>
            <option value={20}>{t("sidebar.maxUses20")}</option>
          </select>
          {inviteError ? (
            <p className="error inline-error" style={{ fontSize: 12, margin: 0 }}>{inviteError}</p>
          ) : null}
          <div className="connection-code-panel-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setActivePanel("none")}
              disabled={inviteLoading}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleGenerateInvite}
              disabled={inviteLoading}
            >
              {inviteLoading ? "…" : t("room.generateAndCopy")}
            </button>
          </div>
          {createdInvite ? (
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
                {inviteRevealed ? createdInvite.url : maskInviteUrl(createdInvite.url)}
              </code>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "4px 8px" }} onClick={() => setInviteRevealed((v) => !v)}>
                  {inviteRevealed ? t("sidebar.hideInvite") : t("sidebar.revealInvite")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: "4px 8px" }}
                  aria-label={t("sidebar.copyInviteLink")}
                  onClick={() => navigator.clipboard.writeText(createdInvite!.url).catch(() => {})}
                >
                  {t("sidebar.copyInvite")}
                </button>
              </div>
            </div>
          ) : null}
          {invites.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h4 style={{ fontSize: 13, marginBottom: 8 }}>{t("sidebar.activeInvites")}</h4>
              {invites.map((inv) => (
                <div
                  key={inv.invite_id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "6px 8px",
                    marginBottom: 4,
                    background: "var(--surface-warm)",
                    border: "1px solid var(--border-soft)",
                    borderRadius: "var(--radius-chip)",
                    fontSize: 12,
                    opacity: inv.revoked ? 0.6 : 1
                  }}
                >
                  <span>
                    {t("sidebar.inviteItem", { role: inv.role, remaining: inv.remaining, max: inv.max_uses })}
                  </span>
                  {inv.revoked && (
                    <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{t("sidebar.inviteRevoked")}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  ) : null;

  return (
    <div className="room-identity">
      <div>
        <h2>{roomName}</h2>
        {userLine ? <p>{userLine}</p> : null}
      </div>
      {isOwner ? (
        <div className="room-id-chip-wrapper">
          {onCreateInvite ? (
            <button
              ref={inviteButtonRef}
              type="button"
              className={`room-id-chip${inviteCopied ? " copied" : ""}`}
              onClick={() => togglePanel("invite")}
              aria-label={inviteCopied ? t("sidebar.connectionCodeCopied") : t("room.copyInvite")}
              title={inviteCopied ? t("sidebar.connectionCodeCopied") : t("room.copyInvite")}
            >
              {inviteCopied ? <CopyIcon /> : <InviteIcon />}
            </button>
          ) : null}
          {onCreatePairing ? (
            <button
              ref={pairingButtonRef}
              type="button"
              className={`room-id-chip${pairingCopied ? " copied" : ""}`}
              onClick={() => togglePanel("pairing")}
              aria-label={pairingCopied ? t("sidebar.connectionCodeCopied") : t("room.copyConnectionCode")}
              title={pairingCopied ? t("sidebar.connectionCodeCopied") : t("room.copyConnectionCode")}
            >
              {pairingCopied ? <CopyIcon /> : <LinkIcon />}
            </button>
          ) : (
            <button type="button" className="room-id-chip" onClick={() => onCopyRoomId(roomId)} aria-label={t("room.copyId")} title={roomId}>
              <span>{shortRoomId(roomId)}</span>
              <CopyIcon />
            </button>
          )}
          {panel && typeof document !== "undefined" && createPortal(panel, document.body)}
        </div>
      ) : (
        <button type="button" className="room-id-chip" onClick={() => onCopyRoomId(roomId)} aria-label={t("room.copyId")} title={roomId}>
          <span>{shortRoomId(roomId)}</span>
          <CopyIcon />
        </button>
      )}
    </div>
  );
}
