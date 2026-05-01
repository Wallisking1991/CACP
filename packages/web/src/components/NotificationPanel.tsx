import { useT } from "../i18n/useT.js";
import type { JoinRequestView } from "../room-state.js";

export interface NotificationPanelProps {
  joinRequests: JoinRequestView[];
  roundtableRequest?: { request_id: string; display_name: string; created_at: string };
  turnInFlight: boolean;
  onApproveJoinRequest: (requestId: string) => void;
  onRejectJoinRequest: (requestId: string) => void;
  onApproveRoundtableRequest: (requestId: string) => void;
  onRejectRoundtableRequest: (requestId: string) => void;
}

export function NotificationPanel({
  joinRequests,
  roundtableRequest,
  turnInFlight,
  onApproveJoinRequest,
  onRejectJoinRequest,
  onApproveRoundtableRequest,
  onRejectRoundtableRequest,
}: NotificationPanelProps) {
  const t = useT();
  const hasNotifications = joinRequests.length > 0 || roundtableRequest;

  return (
    <div className="popover-content notification-popover">
      <h3 className="popover-title">{t("sidebar.notificationsLabel")}</h3>
      {!hasNotifications ? (
        <p className="popover-empty">{t("sidebar.noNotifications")}</p>
      ) : (
        <div className="popover-list">
          {joinRequests.map((req) => (
            <div key={req.request_id} className="popover-list-item">
              <span className="popover-list-item-name">{req.display_name}</span>
              <span className="popover-list-item-meta">{t("sidebar.joinRequestLabel")}</span>
              <span className="popover-list-item-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => onApproveJoinRequest(req.request_id)}
                >
                  {t("sidebar.approve")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onRejectJoinRequest(req.request_id)}
                >
                  {t("sidebar.reject")}
                </button>
              </span>
            </div>
          ))}
          {roundtableRequest ? (
            <div key={roundtableRequest.request_id} className="popover-list-item">
              <span className="popover-list-item-name">{roundtableRequest.display_name}</span>
              <span className="popover-list-item-meta">{t("sidebar.roundtableRequestLabel")}</span>
              <span className="popover-list-item-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={turnInFlight}
                  onClick={() => onApproveRoundtableRequest(roundtableRequest.request_id)}
                >
                  {t("sidebar.start")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onRejectRoundtableRequest(roundtableRequest.request_id)}
                >
                  {t("sidebar.reject")}
                </button>
              </span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
