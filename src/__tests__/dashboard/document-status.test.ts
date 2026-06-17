import { describe, expect, it } from "vitest";
import { getDashboardDocumentStatusDisplay } from "@/lib/dashboard/document-status";

describe("getDashboardDocumentStatusDisplay", () => {
  it("maps ready documents to Ready", () => {
    expect(getDashboardDocumentStatusDisplay("ready").label).toBe("Ready");
  });

  it("maps indexing_graph documents to Indexing graph", () => {
    expect(getDashboardDocumentStatusDisplay("indexing_graph").label).toBe("Indexing graph");
  });
});
