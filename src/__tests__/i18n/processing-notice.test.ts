import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/locales/en";
import zhCN from "@/lib/i18n/locales/zh-CN";
import { formatCount } from "@/lib/i18n/format";

describe("processing notice translations", () => {
  it("uses the concise queued title and total-time label", () => {
    expect(zhCN.documents.processingNotice.queuedTitle).toBe("文档已就绪，等待处理");
    expect(en.documents.processingNotice.queuedTitle).toBe("Documents are ready for processing");
    expect(zhCN.documents.processingNotice.estimatedTime).toBe("预计总处理时间：{range}");
    expect(en.documents.processingNotice.estimatedTime).toBe("Estimated total processing time: {range}");
  });

  it("explains the estimate basis and the factors that can extend processing", () => {
    expect(zhCN.documents.processingNotice.estimateDisclaimer).toContain("文档大小");
    expect(zhCN.documents.processingNotice.estimateDisclaimer).toContain("文件数量");
    expect(zhCN.documents.processingNotice.estimateDisclaimer).toContain("处理模式");
    expect(zhCN.documents.processingNotice.estimateDisclaimer).toContain("模型服务响应速度");
    expect(zhCN.documents.processingNotice.estimateDisclaimer).toContain("服务负载");
    expect(zhCN.documents.processingNotice.estimateDisclaimer).toContain("限流");
    expect(zhCN.documents.processingNotice.estimateDisclaimer).toContain("网络状况");

    expect(en.documents.processingNotice.estimateDisclaimer).toContain("document size");
    expect(en.documents.processingNotice.estimateDisclaimer).toContain("file count");
    expect(en.documents.processingNotice.estimateDisclaimer).toContain("processing mode");
    expect(en.documents.processingNotice.estimateDisclaimer).toContain("model service response speed");
    expect(en.documents.processingNotice.estimateDisclaimer).toContain("service load");
    expect(en.documents.processingNotice.estimateDisclaimer).toContain("rate limits");
    expect(en.documents.processingNotice.estimateDisclaimer).toContain("network conditions");
  });

  it("formats file counts through localized singular and plural templates", () => {
    expect(formatCount(1, en.documents.processingNotice.fileCount)).toBe("1 file");
    expect(formatCount(2, en.documents.processingNotice.fileCount)).toBe("2 files");
    expect(formatCount(1, zhCN.documents.processingNotice.fileCount)).toBe("1 个文件");
    expect(formatCount(3, zhCN.documents.processingNotice.fileCount)).toBe("3 个文件");
  });
});
