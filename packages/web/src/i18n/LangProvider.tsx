import { createContext, useCallback, useMemo, useState, type ReactNode } from "react";
import enMessages from "./messages.en.json";
import zhMessages from "./messages.zh.json";

export type Lang = "en" | "zh";

export interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

export const LangContext = createContext<LangContextValue | null>(null);

const STORAGE_KEY = "cacp.web.lang";

export function resolveLang(storageValue: string | null, navigatorLang: string): Lang {
  if (storageValue === "zh" || storageValue === "en") {
    return storageValue;
  }
  if (navigatorLang.toLowerCase().startsWith("zh")) {
    return "zh";
  }
  return "en";
}

function getInitialLang(): Lang {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  const navigatorLang = typeof navigator !== "undefined" ? navigator.language : "en";
  return resolveLang(stored, navigatorLang);
}

export interface LangProviderProps {
  children: ReactNode;
}

export function LangProvider({ children }: LangProviderProps) {
  const [lang, setLangState] = useState<Lang>(getInitialLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export type Messages = typeof enMessages;

export const messageCatalog: Record<Lang, Messages> = {
  en: enMessages,
  zh: zhMessages
};
