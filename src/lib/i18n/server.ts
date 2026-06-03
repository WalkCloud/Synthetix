import { cookies, headers } from "next/headers";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, LOCALE_COOKIE_KEY, type Locale } from "./constants";

/**
 * Resolve the user's preferred locale on the server side.
 *
 * Priority: cookie > Accept-Language header > default
 */
export async function resolveLocale(): Promise<Locale> {
  // 1. Check cookie
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_KEY)?.value;
  if (cookieLocale && (SUPPORTED_LOCALES as readonly string[]).includes(cookieLocale)) {
    return cookieLocale as Locale;
  }

  // 2. Check Accept-Language header
  const headersList = await headers();
  const acceptLanguage = headersList.get("accept-language");
  if (acceptLanguage) {
    const preferred = parseAcceptLanguage(acceptLanguage);
    if (preferred) return preferred;
  }

  return DEFAULT_LOCALE;
}

/**
 * Parse the Accept-Language header and find the first matching supported locale.
 */
function parseAcceptLanguage(header: string): Locale | null {
  const locales = header
    .split(",")
    .map((part) => {
      const [lang, qStr] = part.trim().split(";q=");
      const quality = qStr ? parseFloat(qStr) : 1.0;
      return { lang: lang.trim(), quality };
    })
    .sort((a, b) => b.quality - a.quality);

  for (const { lang } of locales) {
    const normalized = normalizeLangTag(lang);
    if ((SUPPORTED_LOCALES as readonly string[]).includes(normalized)) {
      return normalized as Locale;
    }
  }

  // Try base language match (e.g. "zh" matches "zh-CN")
  for (const { lang } of locales) {
    const base = lang.split("-")[0].toLowerCase();
    for (const supported of SUPPORTED_LOCALES) {
      if (supported.toLowerCase().startsWith(base)) {
        return supported as Locale;
      }
    }
  }

  return null;
}

function normalizeLangTag(tag: string): string {
  const parts = tag.split("-");
  if (parts.length === 1) return parts[0].toLowerCase();
  return `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
}
