import type { JoinRequestView } from "../room-state.js";
import { useT } from "../i18n/useT.js";

export interface JoinRequestModalProps {
  request?: JoinRequestView;
  remainingCount: number;
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
  onLater: (requestId: string) => void;
}

export default function JoinRequestModal({ request, remainingCount, onApprove, onReject, onLater }: JoinRequestModalProps) {
  const t = useT();
  if (!request) return null;

  return (
    <div className="modal-overlay" role="presentation">
      <section className="join-request-modal" role="dialog" aria-modal="true" aria-label={t("joinRequestModal.title")}>
        <p className="landing-eyebrow" style={{ marginBottom: 8 }}>{t("joinRequestModal.title")}</p>
        <h3>{t("joinRequestModal.body", { name: request.display_name })}</h3>
        {remainingCount > 0 && (
          <p className="join-request-modal-subcopy">{t("joinRequestModal.more", { count: remainingCount })}</p>
        )}
        <div className="join-request-modal-actions">
          <button type="button" className="btn btn-primary" onClick={() => onApprove(request.request_id)}>
            {t("sidebar.approve")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onReject(request.request_id)}>
            {t("sidebar.reject")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onLater(request.request_id)}>
            {t("joinRequestModal.later")}
          </button>
        </div>
      </section>
    </div>
  );
}
