import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/locales/en";
import zhCN from "@/lib/i18n/locales/zh-CN";
import { getDocumentStatusLabel } from "@/lib/i18n/document-status";

describe("document status localization", () => {
  it("maps known document statuses", () => {
    expect(getDocumentStatusLabel("ready", en.common.states)).toBe(en.common.states.ready);
    expect(getDocumentStatusLabel("indexing_graph", zhCN.common.states)).toBe(zhCN.common.states.indexingGraph);
  });

  it("does not expose unknown technical status tokens", () => {
    expect(getDocumentStatusLabel("vendor_internal_stage", en.common.states)).toBe(en.common.states.unknown);
    expect(getDocumentStatusLabel("vendor_internal_stage", zhCN.common.states)).toBe(zhCN.common.states.unknown);
  });
});
