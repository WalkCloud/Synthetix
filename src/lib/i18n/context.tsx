"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import en from "./locales/en";
import zhCN from "./locales/zh-CN";
import type { TranslationSchema } from "./types";
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, LOCALE_COOKIE_KEY, type Locale, SUPPORTED_LOCALES } from "./constants";
import { formatDate, formatRelativeTime, formatFileSize, formatNumber, formatPercent, interpolate } from "./format";

const localeMap: Record<Locale, TranslationSchema> = {
  en,
  "zh-CN": zhCN,
};

interface FormatHelpers {
  date: (date: Date | string) => string;
  relativeTime: (date: Date | string) => string;
  fileSize: (bytes: number) => string;
  number: (num: number) => string;
  percent: (value: number) => string;
  template: (template: string, params: Record<string, string | number>) => string;
}

interface LocaleContextValue {
  locale: Locale;
  t: TranslationSchema;
  setLocale: (locale: Locale) => void;
  format: FormatHelpers;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  t: en,
  setLocale: () => {},
  format: {
    date: (d) => String(d),
    relativeTime: (d) => String(d),
    fileSize: (b) => String(b),
    number: (n) => String(n),
    percent: (v) => String(v),
    template: (t) => t,
  },
});

function isValidLocale(value: string | null): value is Locale {
  return value !== null && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function LocaleProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isValidLocale(stored)) {
      setLocaleState(stored);
      document.documentElement.lang = stored;
    } else {
      document.documentElement.lang = initialLocale;
    }
  }, [initialLocale]);

  const format = useMemo<FormatHelpers>(() => ({
    date: (date) => formatDate(date, locale),
    relativeTime: (date) => formatRelativeTime(date, locale),
    fileSize: (bytes) => formatFileSize(bytes, locale),
    number: (num) => formatNumber(num, locale),
    percent: (value) => formatPercent(value, locale),
    template: (template, params) => interpolate(template, params),
  }), [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem(LOCALE_STORAGE_KEY, newLocale);
    document.documentElement.lang = newLocale;
    document.cookie = `${LOCALE_COOKIE_KEY}=${newLocale};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;
  }, []);

  const t = localeMap[locale];

  return (
    <LocaleContext.Provider value={{ locale, t, setLocale, format }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}

export type { Locale };
