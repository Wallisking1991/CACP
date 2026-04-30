import { useState } from "react";
import type { AgentView, ParticipantView } from "../room-state.js";
import { useT } from "../i18n/useT.js";
import { SoundIcon } from "./RoomIcons.js";

export interface RoomControlCenterProps {
  open: boolean;
  onClose: () => void;
  soundEnabled: boolean;
  onSoundEnabledChange: (enabled: boolean) => void;
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
}

type ControlSection = "agent" | "people" | "invite" | "room" | "sound" | "advanced";

export function RoomControlCenter(props: RoomControlCenterProps) {
  const t = useT();
  const [section, setSection] = useState<ControlSection>("agent");
  const activeAgent = props.agents.find((agent) => agent.agent_id === props.activeAgentId);
  if (!props.open) return null;

  const sections: Array<{ id: ControlSection; label: string }> = [
    { id: "agent", label: "Agent" },
    { id: "people", label: "People" },
    { id: "invite", label: "Invite" },
    { id: "room", label: "Room" },
    { id: "sound", label: "Sound" },
    { id: "advanced", label: "Advanced" }
  ];

  return (
    <div className="room-control-overlay" onClick={props.onClose}>
      <section className="room-control-center" role="dialog" aria-modal="true" aria-label="Room Control Center" onClick={(event) => event.stopPropagation()}>
        <header className="room-control-center__header">
          <div>
            <p className="section-label">CACP</p>
            <h2>Room Control Center</h2>
          </div>
          <button type="button" className="room-icon-button" onClick={props.onClose} aria-label={t("sidebar.close")}>×</button>
        </header>
        <nav className="room-control-center__tabs" aria-label="Room controls">
          {sections.map((item) => (
            <button key={item.id} type="button" className={section === item.id ? "is-active" : ""} onClick={() => setSection(item.id)} aria-label={item.label}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="room-control-center__body">
          {section === "agent" && (
            <section className="agent-cockpit">
              <h3>{activeAgent?.name ?? "No active agent"}</h3>
              <p>{activeAgent ? `${activeAgent.status} · ${activeAgent.capabilities.join(" · ") || "no capabilities"}` : "Connect an agent from the room setup flow."}</p>
              {props.agents.length > 1 ? (
                <select className="input" value={props.activeAgentId ?? ""} onChange={(event) => props.onSelectAgent(event.target.value)}>
                  {props.agents.map((agent) => <option key={agent.agent_id} value={agent.agent_id}>{agent.name}</option>)}
                </select>
              ) : null}
            </section>
          )}
          {section === "people" && (
            <section>
              <h3>People</h3>
              {props.participants.map((participant) => (
                <div key={participant.id} className="people-row">
                  <span>{participant.display_name} · {participant.role}</span>
                  {props.isOwner && participant.role !== "owner" ? (
                    <button type="button" className="btn btn-ghost" onClick={() => props.onRemoveParticipant(participant.id)}>Remove</button>
                  ) : null}
                </div>
              ))}
            </section>
          )}
          {section === "invite" && (
            <section>
              <h3>Invite</h3>
              <p>{props.inviteCount} invites</p>
              <button type="button" className="btn btn-warm" onClick={() => void props.onCreateInvite("member", 3600)}>Copy member invite</button>
            </section>
          )}
          {section === "room" && (
            <section>
              <h3>Room</h3>
              <p>{props.roomId}</p>
              <button type="button" className="btn btn-ghost" onClick={props.onLeaveRoom}>Leave room</button>
              {props.isOwner ? <button type="button" className="btn btn-warm-ghost" onClick={props.onClearRoom}>Clear conversation</button> : null}
            </section>
          )}
          {section === "sound" && (
            <section>
              <h3><SoundIcon /> Sound</h3>
              <button type="button" role="switch" aria-checked={props.soundEnabled} onClick={() => props.onSoundEnabledChange(!props.soundEnabled)}>
                Sound cues
              </button>
              <button type="button" className="btn btn-ghost" onClick={props.onTestSound}>Test sound</button>
            </section>
          )}
          {section === "advanced" && (
            <section>
              <h3>Advanced</h3>
              <p>Agent logs and protocol diagnostics appear here as they become available.</p>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
