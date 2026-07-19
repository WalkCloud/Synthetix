import type { Locale } from "./constants";

function getDateFormatter(locale: Locale): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getRelativeTimeFormatter(locale: Locale): Intl.RelativeTimeFormat {
  return new Intl.RelativeTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    numeric: "auto",
    style: "long",
  });
}

export function formatDate(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return getDateFormatter(locale).format(d);
}

export function formatRelativeTime(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHour = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHour / 24);

  const rtf = getRelativeTimeFormatter(locale);

  if (Math.abs(diffSec) < 60) {
    return rtf.format(-diffSec, "second");
  } else if (Math.abs(diffMin) < 60) {
    return rtf.format(-diffMin, "minute");
  } else if (Math.abs(diffHour) < 24) {
    return rtf.format(-diffHour, "hour");
  } else if (Math.abs(diffDay) < 30) {
    return rtf.format(-diffDay, "day");
  } else {
    return formatDate(date, locale);
  }
}

export function formatFileSize(bytes: number, locale: Locale): string {
  const units = locale === "zh-CN"
    ? ["字节", "KB", "MB", "GB", "TB"]
    : ["B", "KB", "MB", "GB", "TB"];

  if (bytes === 0) return `0 ${units[0]}`;

  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatNumber(num: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en-US").format(num);
}

export function formatPercent(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value / 100);
}

export function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    key in params ? String(params[key]) : `{${key}}`
  );
}

export function formatCount(
  count: number,
  templates: { one: string; other: string },
): string {
  return interpolate(count === 1 ? templates.one : templates.other, { n: count });
}
