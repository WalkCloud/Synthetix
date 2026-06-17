import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/locales/en";
import zhCN from "@/lib/i18n/locales/zh-CN";

describe("brainstorm labels", () => {
  it("labels the completed-outline action as importing into writing", () => {
    expect(zhCN.brainstorm.importToWriting).toBe("导入文档撰写");
    expect(en.brainstorm.importToWriting).toBe("Import to Document Writing");
  });
});
