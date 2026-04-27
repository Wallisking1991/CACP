import { useT } from "../i18n/useT.js";

interface WaitingRoomProps {
  displayName: string;
  onCancel: () => void;
}

export default function WaitingRoom({ displayName, onCancel }: WaitingRoomProps) {
  const t = useT();

  return (
    <main className="landing-shell">
      <div className="landing-card" style={{ textAlign: "center" }}>
        <p className="landing-eyebrow">{t("waitingRoom.eyebrow")}</p>
        <h1 className="landing-headline">{t("waitingRoom.headline")}</h1>
        <p className="landing-subcopy">
          {t("waitingRoom.subcopy", { name: displayName })}
        </p>

        <div style={{ margin: "24px 0" }}>
          <div
            style={{
              width: 40,
              height: 40,
              border: "3px solid var(--border-soft)",
              borderTop: "3px solid var(--accent)",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              margin: "0 auto",
            }}
          />
        </div>

        <p style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 16 }}>
          {t("waitingRoom.polling")}
        </p>

        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          {t("waitingRoom.cancel")}
        </button>
      </div>

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </main>
  );
}
