import { describe, expect, it } from "vitest";
import { getDashboardDocumentStatusDisplay } from "@/lib/dashboard/document-status";

describe("getDashboardDocumentStatusDisplay", () => {
  it("maps ready documents to Ready", () => {
    expect(getDashboardDocumentStatusDisplay("ready").label).toBe("Ready");
  });
});
