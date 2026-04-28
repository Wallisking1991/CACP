import type { RoundtableRequestView } from "../room-state.js";
import { useT } from "../i18n/useT.js";

export interface RoundtableRequestModalProps {
  request?: RoundtableRequestView;
  turnInFlight: boolean;
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
  onLater: (requestId: string) => void;
}

export default function RoundtableRequestModal({ request, turnInFlight, onApprove, onReject, onLater }: RoundtableRequestModalProps) {
  const t = useT();
  if (!request) return null;
  return (
    <div className="modal-overlay" role="presentation">
      <section className="join-request-modal" role="dialog" aria-modal="true" aria-label={t("roundtableRequestModal.title")}>
        <p className="landing-eyebrow" style={{ marginBottom: 8 }}>{t("roundtableRequestModal.title")}</p>
        <h3>{t("roundtableRequestModal.body", { name: request.requester_name })}</h3>
        {turnInFlight && <p className="join-request-modal-subcopy">{t("roundtableRequestModal.waitForTurn")}</p>}
        <div className="join-request-modal-actions">
          <button type="button" className="btn btn-primary" disabled={turnInFlight} onClick={() => onApprove(request.request_id)}>{t("roundtableRequestModal.start")}</button>
          <button type="button" className="btn btn-ghost" onClick={() => onReject(request.request_id)}>{t("sidebar.reject")}</button>
          <button type="button" className="btn btn-ghost" onClick={() => onLater(request.request_id)}>{t("joinRequestModal.later")}</button>
        </div>
      </section>
    </div>
  );
}
