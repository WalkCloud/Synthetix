"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import zhCN, { type TranslationKeys } from "./locales/zh-CN";
import en from "./locales/en";

export type Locale = "zh-CN" | "en";

const STORAGE_KEY = "synthetix-locale";

const localeMap: Record<Locale, TranslationKeys> = {
  "zh-CN": zhCN,
  en,
};

interface LocaleContextValue {
  locale: Locale;
  t: TranslationKeys;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "zh-CN",
  t: zhCN,
  setLocale: () => {},
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("zh-CN");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (stored && localeMap[stored]) {
      setLocaleState(stored);
    }
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem(STORAGE_KEY, newLocale);
  }, []);

  const t = localeMap[locale];

  return (
    <LocaleContext.Provider value={{ locale, t, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
