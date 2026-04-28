import { useCallback, useState } from "react";
import { useT } from "../i18n/useT.js";

export interface ConnectionCodeModalPairing {
  connection_code: string;
  download_url: string;
  expires_at: string;
}

export interface ConnectionCodeModalProps {
  pairing?: ConnectionCodeModalPairing;
  onClose: () => void;
}

export default function ConnectionCodeModal({ pairing, onClose }: ConnectionCodeModalProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const handleCopy = useCallback(() => {
    if (!pairing) return;
    setCopyFailed(false);
    if (!navigator.clipboard?.writeText) {
      setCopyFailed(true);
      return;
    }
    navigator.clipboard.writeText(pairing.connection_code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      setCopyFailed(true);
    });
  }, [pairing]);

  if (!pairing) return null;

  return (
    <div className="modal-overlay" role="presentation">
      <section className="join-request-modal" role="dialog" aria-modal="true" aria-label={t("connectorModal.title")}>
        <p className="landing-eyebrow" style={{ marginBottom: 8 }}>{t("sidebar.connectorLabel")}</p>
        <h3>{t("connectorModal.title")}</h3>
        <p className="join-request-modal-subcopy">{t("connectorModal.body")}</p>
        <ol style={{ margin: "0 0 16px 18px", color: "var(--ink-3)", fontSize: 13 }}>
          <li>{t("connectorModal.stepDownload")}</li>
          <li>{t("connectorModal.stepCopy")}</li>
          <li>{t("connectorModal.stepPaste")}</li>
        </ol>
        <div className="join-request-modal-actions">
          <a className="btn btn-warm" href={pairing.download_url} download>
            {t("connectorModal.download")}
          </a>
          <button type="button" className="btn btn-primary" onClick={handleCopy}>
            {copied ? t("sidebar.connectionCodeCopied") : t("sidebar.copyConnectionCode")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t("sidebar.close")}
          </button>
        </div>
        <p style={{ color: "var(--ink-4)", fontSize: 12, margin: "12px 0 0" }}>
          {t("connectorModal.expires", { expiresAt: new Date(pairing.expires_at).toLocaleString() })}
        </p>
        {copyFailed && (
          <div style={{ marginTop: 12 }}>
            <p className="error inline-error" style={{ marginBottom: 8 }}>{t("connectorModal.copyFailed")}</p>
            <textarea
              className="input"
              readOnly
              rows={4}
              aria-label={t("connectorModal.manualCodeLabel")}
              value={pairing.connection_code}
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>
        )}
      </section>
    </div>
  );
}
