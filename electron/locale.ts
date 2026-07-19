export type NativeLocale = "en" | "zh-CN";

type TemplateValues = Record<string, string | number | null | undefined>;

interface NativeStringTemplates {
  openSynthetix: string;
  quit: string;
  backendStoppedTitle: string;
  backendStoppedMessage: string;
  startFailedTitle: string;
  startFailedMessage: string;
}

export interface NativeStrings {
  openSynthetix: string;
  quit: string;
  backendStoppedTitle: string;
  backendStoppedMessage: (values: { code: number | null; logPath: string }) => string;
  startFailedTitle: string;
  startFailedMessage: (values: { error: string; logPath: string }) => string;
}

const STRINGS: Record<NativeLocale, NativeStringTemplates> = {
  en: {
    openSynthetix: "Open Synthetix",
    quit: "Quit",
    backendStoppedTitle: "Synthetix backend stopped",
    backendStoppedMessage:
      "The local server exited unexpectedly (code {code}). See {logPath}.",
    startFailedTitle: "Synthetix failed to start",
    startFailedMessage:
      "Synthetix could not start its local backend:\n\n{error}\n\nCheck the server log in:\n{logPath}",
  },
  "zh-CN": {
    openSynthetix: "打开 Synthetix",
    quit: "退出",
    backendStoppedTitle: "Synthetix 后端已停止",
    backendStoppedMessage: "本地服务器意外退出（退出代码 {code}）。请查看日志：{logPath}。",
    startFailedTitle: "Synthetix 启动失败",
    startFailedMessage:
      "Synthetix 无法启动本地后端：\n\n{error}\n\n请查看服务器日志：\n{logPath}",
  },
};

export function normalizeLocale(locale: string | null | undefined): NativeLocale {
  return locale?.trim().replace(/_/g, "-").toLowerCase().startsWith("zh")
    ? "zh-CN"
    : "en";
}

export async function resolveNativeLocale(
  readPersistedLocale: () => Promise<string | null | undefined>,
  getSystemLocale: () => string
): Promise<NativeLocale> {
  try {
    const persistedLocale = await readPersistedLocale();
    if (persistedLocale) return normalizeLocale(persistedLocale);
  } catch {
    // Persistence is best-effort; native UI must never block app startup.
  }
  return normalizeLocale(getSystemLocale());
}

function interpolate(template: string, values: TemplateValues): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : placeholder
  );
}

export function nativeStrings(locale: NativeLocale): NativeStrings {
  const strings = STRINGS[locale];
  return {
    openSynthetix: strings.openSynthetix,
    quit: strings.quit,
    backendStoppedTitle: strings.backendStoppedTitle,
    backendStoppedMessage: (values) => interpolate(strings.backendStoppedMessage, values),
    startFailedTitle: strings.startFailedTitle,
    startFailedMessage: (values) => interpolate(strings.startFailedMessage, values),
  };
}
