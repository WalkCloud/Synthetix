import type { Locale } from "./constants";

export interface LocaleEntry {
  code: Locale;
  name: string;
  nativeName: string;
  enabled: boolean;
}

export const LOCALE_REGISTRY: LocaleEntry[] = [
  { code: "en", name: "English", nativeName: "English", enabled: true },
  { code: "zh-CN", name: "Chinese (Simplified)", nativeName: "简体中文", enabled: true },
];

export function getLocaleEntry(code: Locale): LocaleEntry | undefined {
  return LOCALE_REGISTRY.find((e) => e.code === code);
}

export function getEnabledLocales(): LocaleEntry[] {
  return LOCALE_REGISTRY.filter((e) => e.enabled);
}
