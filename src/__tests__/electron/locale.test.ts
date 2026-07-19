import { describe, expect, it } from "vitest";

import {
  nativeStrings,
  normalizeLocale,
  resolveNativeLocale,
} from "../../../electron/locale";

describe("normalizeLocale", () => {
  it.each(["zh", "zh-CN", "zh-TW", "ZH-hant", "zh_HK"])(
    "maps %s to zh-CN",
    (locale) => {
      expect(normalizeLocale(locale)).toBe("zh-CN");
    }
  );

  it.each(["en", "en-US", "fr-FR", "", undefined, null])(
    "maps %s to en",
    (locale) => {
      expect(normalizeLocale(locale)).toBe("en");
    }
  );
});

describe("resolveNativeLocale", () => {
  it("prefers the persisted locale over the system locale", async () => {
    await expect(resolveNativeLocale(async () => "zh-TW", () => "en-US")).resolves.toBe(
      "zh-CN"
    );
  });

  it("uses the system locale when no persisted locale exists", async () => {
    await expect(resolveNativeLocale(async () => undefined, () => "zh-HK")).resolves.toBe(
      "zh-CN"
    );
  });

  it("uses the system locale when reading persistence fails", async () => {
    await expect(
      resolveNativeLocale(async () => {
        throw new Error("cookie unavailable");
      }, () => "en-GB")
    ).resolves.toBe("en");
  });
});

describe("nativeStrings", () => {
  it("returns English tray and backend error strings", () => {
    const strings = nativeStrings("en");

    expect(strings.openSynthetix).toBe("Open Synthetix");
    expect(strings.quit).toBe("Quit");
    expect(strings.backendStoppedTitle).toBe("Synthetix backend stopped");
    expect(strings.backendStoppedMessage({ code: 7, logPath: "/tmp/server.log" })).toBe(
      "The local server exited unexpectedly (code 7). See /tmp/server.log."
    );
    expect(strings.startFailedTitle).toBe("Synthetix failed to start");
    expect(
      strings.startFailedMessage({ error: "port unavailable", logPath: "/tmp/server.log" })
    ).toBe(
      "Synthetix could not start its local backend:\n\nport unavailable\n\nCheck the server log in:\n/tmp/server.log"
    );
  });

  it("returns Chinese tray and backend error strings with placeholders", () => {
    const strings = nativeStrings("zh-CN");

    expect(strings.openSynthetix).toBe("打开 Synthetix");
    expect(strings.quit).toBe("退出");
    expect(strings.backendStoppedTitle).toBe("Synthetix 后端已停止");
    expect(strings.backendStoppedMessage({ code: null, logPath: "C:\\data\\server.log" })).toBe(
      "本地服务器意外退出（退出代码 null）。请查看日志：C:\\data\\server.log。"
    );
    expect(strings.startFailedTitle).toBe("Synthetix 启动失败");
    expect(
      strings.startFailedMessage({ error: "端口不可用", logPath: "C:\\data\\server.log" })
    ).toBe(
      "Synthetix 无法启动本地后端：\n\n端口不可用\n\n请查看服务器日志：\nC:\\data\\server.log"
    );
  });
});
