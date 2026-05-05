import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { AvatarStatusView } from "../room-state.js";
import { assignAgentColor } from "./agent-ripple-utils.js";

interface AgentRippleOverlayProps {
  avatarStatuses: AvatarStatusView[];
  turnInFlight: boolean;
}

interface AgentPosition {
  id: string;
  x: number;
  y: number;
  color: string;
  mode: "thinking" | "streaming";
}

interface Ripple {
  id: number;
  agentId: string;
  x: number;
  y: number;
  mode: "thinking" | "streaming";
  color: string;
}

function getWorkingAgentPositions(avatars: AvatarStatusView[]): AgentPosition[] {
  const working = avatars.filter(
    (a) => a.kind === "agent" && (a.status === "working" || a.status === "typing")
  );

  return working
    .map((agent) => {
      const el = document.querySelector(`[data-avatar-id="${agent.id}"]`) as HTMLElement | null;
      const rect = el?.getBoundingClientRect();
      const x = rect ? rect.left + rect.width / 2 : 0;
      const y = rect ? rect.top + rect.height / 2 : 0;

      return {
        id: agent.id,
        x,
        y,
        color: assignAgentColor(agent.id),
        mode: agent.status === "typing" ? "streaming" : "thinking",
      };
    })
    .filter((pos) => pos.x > 0 && pos.y > 0);
}

export default function AgentRippleOverlay({ avatarStatuses, turnInFlight }: AgentRippleOverlayProps) {
  const [positions, setPositions] = useState<AgentPosition[]>([]);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const nextIdRef = useRef(0);

  // Update positions when avatarStatuses change
  useEffect(() => {
    function update() {
      const newPositions = getWorkingAgentPositions(avatarStatuses);
      setPositions(newPositions);
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [avatarStatuses]);

  // Spawn ripples
  useEffect(() => {
    if (positions.length === 0) return;

    const timers: Array<ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>> = [];

    for (const agent of positions) {
      const intervalMs = agent.mode === "streaming" ? 800 : 2500;
      const initialDelay = agent.mode === "thinking" ? 1500 : 0;

      const spawn = () => {
        setRipples((prev) => {
          const next: Ripple = {
            id: nextIdRef.current++,
            agentId: agent.id,
            x: agent.x,
            y: agent.y,
            mode: agent.mode,
            color: agent.color,
          };
          return [...prev, next].slice(-9);
        });
      };

      const initialTimer = setTimeout(() => {
        spawn();
        const interval = setInterval(spawn, intervalMs);
        timers.push(interval);
      }, initialDelay);

      timers.push(initialTimer);
    }

    return () => {
      for (const t of timers) clearInterval(t);
      for (const t of timers) clearTimeout(t);
    };
  }, [positions]);

  const removeRipple = useCallback((id: number) => {
    setRipples((prev) => prev.filter((r) => r.id !== id));
  }, []);

  if (positions.length === 0) return null;

  return (
    <div className="agent-ripple-overlay" aria-hidden="true">
      {positions.map((agent) => (
        <div key={`${agent.id}-waves`} className="agent-wave-group" style={{ left: agent.x, top: agent.y }}>
          <div
            className="agent-wave-layer agent-wave-layer--1"
            style={{ "--agent-color": agent.color } as React.CSSProperties}
          />
          <div
            className="agent-wave-layer agent-wave-layer--2"
            style={{ "--agent-color": agent.color } as React.CSSProperties}
          />
        </div>
      ))}
      {ripples.map((r) => (
        <div
          key={r.id}
          className={`agent-ripple ${r.mode === "streaming" ? "agent-ripple--streaming" : ""}`}
          style={{ left: r.x, top: r.y, "--agent-color": r.color } as React.CSSProperties}
          onAnimationEnd={() => removeRipple(r.id)}
        />
      ))}
    </div>
  );
}
