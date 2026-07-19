import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { getLocalizedError } from "@/lib/i18n/client-errors";
import en from "@/lib/i18n/locales/en";
import zhCN from "@/lib/i18n/locales/zh-CN";

describe("API error localization", () => {
  describe("getLocalizedError with English errorMap", () => {
    const errorMap = en.errors;

    it("maps known error codes to localized English strings", () => {
      expect(getLocalizedError({ code: "unauthorized" }, errorMap)).toBe(errorMap.unauthorized);
      expect(getLocalizedError({ code: "draftNotFound" }, errorMap)).toBe(errorMap.draftNotFound);
      expect(getLocalizedError({ code: "modelNotConfigured" }, errorMap)).toBe(errorMap.modelNotConfigured);
      expect(getLocalizedError({ code: "exportFailed" }, errorMap)).toBe(errorMap.exportFailed);
      expect(getLocalizedError({ code: "passwordIncorrect" }, errorMap)).toBe(errorMap.passwordIncorrect);
    });

    it("does not expose server messages for unknown codes", () => {
      expect(getLocalizedError({ code: "some_future_code", error: "Something happened" }, errorMap)).toBe(errorMap.unknown);
    });

    it("does not expose server messages when no stable code is present", () => {
      expect(getLocalizedError({ error: "Custom server error" }, errorMap)).toBe(errorMap.unknown);
    });

    it("uses a caller-provided localized domain fallback", () => {
      expect(
        getLocalizedError(
          { code: "some_future_code", error: "Internal provider stack trace" },
          errorMap,
          "Could not save provider",
        ),
      ).toBe("Could not save provider");
    });

    it("documents upload failures use a localized fallback instead of raw server English", () => {
      const serverEnglish = "Virus scanner rejected this upload";
      const localized = getLocalizedError(
        { error: serverEnglish },
        zhCN.errors,
        zhCN.documents.upload.uploadFailed,
      );

      expect(localized).toBe(zhCN.documents.upload.uploadFailed);
      expect(localized).not.toContain(serverEnglish);

      const pageSource = fs.readFileSync(
        path.resolve(process.cwd(), "src/app/(dashboard)/documents/page.tsx"),
        "utf8",
      );
      expect(pageSource).toContain(
        "getLocalizedError(data, t.errors, t.documents.upload.uploadFailed)",
      );
      expect(pageSource).not.toMatch(/error:\s*data\.error/);
    });

    it("falls back to unknown for null/undefined data", () => {
      expect(getLocalizedError(null, errorMap)).toBe(errorMap.unknown);
      expect(getLocalizedError(undefined, errorMap)).toBe(errorMap.unknown);
    });
  });

  describe("getLocalizedError with Chinese errorMap", () => {
    const errorMap = zhCN.errors;

    it("maps known error codes to localized Chinese strings", () => {
      expect(getLocalizedError({ code: "unauthorized" }, errorMap)).toBe("未登录或登录已过期");
      expect(getLocalizedError({ code: "draftNotFound" }, errorMap)).toBe("未找到草稿");
      expect(getLocalizedError({ code: "passwordIncorrect" }, errorMap)).toBe("当前密码不正确");
    });

    it("all error codes in en exist in zh-CN", () => {
      for (const key of Object.keys(en.errors) as (keyof typeof en.errors)[]) {
        expect(zhCN.errors[key]).toBeDefined();
        expect(zhCN.errors[key]).not.toBe("");
      }
    });
  });
});
