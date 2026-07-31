import { useEffect, useRef, useState } from "react";
import type {
  WhiteboardEditorAdapterLoader,
  WhiteboardEditorController,
} from "../whiteboard/whiteboard-editor-adapter.js";
import { useT } from "../i18n/useT.js";

export interface WhiteboardSurfaceProps {
  loadEditorAdapter: WhiteboardEditorAdapterLoader;
  langCode: "en" | "zh";
  name: string;
  readOnly: boolean;
}

export function WhiteboardSurface({
  loadEditorAdapter,
  langCode,
  name,
  readOnly,
}: WhiteboardSurfaceProps) {
  const t = useT();
  const editorLabel = String(t("whiteboard.editorLabel"));
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<WhiteboardEditorController | undefined>(
    undefined
  );
  const mountOptionsRef = useRef({
    ariaLabel: editorLabel,
    langCode,
    name,
    readOnly,
  });
  const latestReadOnlyRef = useRef(readOnly);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );

  useEffect(() => {
    mountOptionsRef.current = {
      ariaLabel: editorLabel,
      langCode,
      name,
      readOnly,
    };
    latestReadOnlyRef.current = readOnly;
  }, [editorLabel, langCode, name, readOnly]);

  useEffect(() => {
    let disposed = false;

    const mountEditor = async () => {
      const host = hostRef.current;
      if (!host) return;

      try {
        const adapter = await loadEditorAdapter();
        if (disposed) return;
        const controller = await adapter.mount(host, mountOptionsRef.current);
        if (disposed) {
          controller.destroy();
          return;
        }
        controllerRef.current = controller;
        controller.setDisplayOptions(mountOptionsRef.current);
        controller.setReadOnly(latestReadOnlyRef.current);
        setStatus("ready");
      } catch {
        if (!disposed) setStatus("error");
      }
    };

    void mountEditor();

    return () => {
      disposed = true;
      controllerRef.current?.destroy();
      controllerRef.current = undefined;
    };
  }, [loadEditorAdapter]);

  useEffect(() => {
    controllerRef.current?.setDisplayOptions({
      ariaLabel: editorLabel,
      langCode,
      name,
    });
  }, [editorLabel, langCode, name]);

  useEffect(() => {
    controllerRef.current?.setReadOnly(readOnly);
  }, [readOnly]);

  return (
    <section className="whiteboard-surface" aria-label={editorLabel}>
      {status === "loading" && (
        <div className="whiteboard-surface__status" role="status">
          {t("whiteboard.loading")}
        </div>
      )}
      {status === "error" && (
        <div className="whiteboard-surface__status" role="alert">
          {t("whiteboard.loadError")}
        </div>
      )}
      <div
        ref={hostRef}
        className="whiteboard-surface__editor"
        aria-hidden={status !== "ready"}
      />
    </section>
  );
}
