import { useT } from "../i18n/useT.js";

export function LogPanel() {
  const t = useT();
  return (
    <div className="popover-content log-popover">
      <h3 className="popover-title">{t("sidebar.logsLink")}</h3>
      <p className="popover-empty">{t("sidebar.placeholderBody")}</p>
    </div>
  );
}
