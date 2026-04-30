import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/useT.js";
import { LinkIcon, CopyIcon } from "./RoomIcons.js";

export interface RoomIdentityProps {
  roomName: string;
  roomId: string;
  userDisplayName?: string;
  userRole?: string;
  isOwner?: boolean;
  onCopyRoomId: (roomId: string) => void;
  onCreatePairing?: (agentType: string, permissionLevel: string) => Promise<string>;
}

function shortRoomId(roomId: string): string {
  if (roomId.length <= 16) return roomId;
  return `${roomId.slice(0, 9)}…${roomId.slice(-5)}`;
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

export function RoomIdentity({ roomName, roomId, userDisplayName, userRole, isOwner, onCopyRoomId, onCreatePairing }: RoomIdentityProps) {
  const t = useT();
  const roleLabel = userRole ? (t(`role.${userRole}` as Parameters<typeof t>[0]) ?? userRole) : "";
  const userLine = [userDisplayName, roleLabel].filter(Boolean).join(" · ");

  const [showPanel, setShowPanel] = useState(false);
  const [agentType, setAgentType] = useState("claude-code");
  const [permissionLevel, setPermissionLevel] = useState("read_only");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>("");
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showPanel && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPanelStyle({
        position: "fixed",
        top: rect.bottom + 6,
        left: rect.left,
      });
    }
  }, [showPanel]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        panelRef.current && !panelRef.current.contains(target)
      ) {
        setShowPanel(false);
      }
    }
    function handleScroll() {
      if (showPanel && buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        setPanelStyle({
          position: "fixed",
          top: rect.bottom + 6,
          left: rect.left,
        });
      }
    }
    if (showPanel) {
      document.addEventListener("mousedown", handleClickOutside);
      window.addEventListener("scroll", handleScroll, true);
      window.addEventListener("resize", handleScroll);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        window.removeEventListener("scroll", handleScroll, true);
        window.removeEventListener("resize", handleScroll);
      };
    }
  }, [showPanel]);

  const handleGenerate = useCallback(async () => {
    if (!onCreatePairing) return;
    setLoading(true);
    setError("");
    try {
      const connectionCode = await onCreatePairing(agentType, permissionLevel);
      await navigator.clipboard.writeText(connectionCode);
      setCopied(true);
      setShowPanel(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("room.generateError");
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [onCreatePairing, agentType, permissionLevel, t]);

  const panel = showPanel ? (
    <div
      ref={panelRef}
      className="connection-code-panel"
      style={panelStyle}
    >
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
      {error ? (
        <p className="error inline-error" style={{ fontSize: 12, margin: 0 }}>{error}</p>
      ) : null}
      <div className="connection-code-panel-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setShowPanel(false)}
          disabled={loading}
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleGenerate}
          disabled={loading}
        >
          {loading ? "…" : t("room.generateAndCopy")}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="room-identity">
      <div>
        <h2>{roomName}</h2>
        {userLine ? <p>{userLine}</p> : null}
      </div>
      {isOwner && onCreatePairing ? (
        <div className="room-id-chip-wrapper">
          <button
            ref={buttonRef}
            type="button"
            className={`room-id-chip${copied ? " copied" : ""}`}
            onClick={() => setShowPanel((prev) => !prev)}
            aria-label={copied ? t("sidebar.connectionCodeCopied") : t("room.copyConnectionCode")}
            title={copied ? t("sidebar.connectionCodeCopied") : t("room.copyConnectionCode")}
          >
            {copied ? <CopyIcon /> : <LinkIcon />}
          </button>
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
