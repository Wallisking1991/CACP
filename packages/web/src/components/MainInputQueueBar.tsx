import { useState } from "react";
import { useT } from "../i18n/useT.js";
import type { MainInputQueueItemView } from "../room-state.js";

export interface MainInputQueueBarProps {
  queue: MainInputQueueItemView[];
  onCancel: (inputId: string) => void;
}

export function MainInputQueueBar({ queue, onCancel }: MainInputQueueBarProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  if (queue.length === 0) return null;

  const isSingle = queue.length === 1;

  return (
    <div className="main-input-queue-bar">
      {isSingle ? (
        <div className="main-input-queue-bar__item">
          <span className="main-input-queue-bar__text">{queue[0].text}</span>
          <button
            type="button"
            className="main-input-queue-bar__cancel"
            aria-label={t("common.cancel")}
            onClick={() => onCancel(queue[0].input_id)}
          >
            {t("common.cancel")}
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="main-input-queue-bar__summary"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
          >
            {t("queue.summary", { count: String(queue.length) })}
          </button>
          {expanded && (
            <div className="main-input-queue-bar__list">
              {queue.map((item) => (
                <div key={item.input_id} className="main-input-queue-bar__item">
                  <span className="main-input-queue-bar__text">{item.text}</span>
                  <button
                    type="button"
                    className="main-input-queue-bar__cancel"
                    aria-label={t("common.cancel")}
                    onClick={() => onCancel(item.input_id)}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
