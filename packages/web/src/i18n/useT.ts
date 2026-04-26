import { useContext } from "react";
import { LangContext, messageCatalog, type Lang } from "./LangProvider.js";
import type { Messages } from "./LangProvider.js";

export type TParams = Record<string, string | number>;

export function useT() {
  const ctx = useContext(LangContext);
  const lang: Lang = ctx?.lang ?? "en";
  const messages = messageCatalog[lang];
  const fallback = messageCatalog.en;

  return function t(key: keyof Messages, params?: TParams): string {
    let text: string | undefined = messages[key];
    if (text === undefined) {
      text = fallback[key];
      if (import.meta.env.DEV && text === undefined) {
        // eslint-disable-next-line no-console
        console.warn(`[i18n] Missing translation key: "${key}"`);
      }
    }
    if (text === undefined) {
      return key;
    }
    if (params) {
      text = text.replace(/\{(\w+)\}/g, (_match, paramKey) => {
        const value = params[paramKey];
        return value !== undefined ? String(value) : _match;
      });
    }
    return text;
  };
}
