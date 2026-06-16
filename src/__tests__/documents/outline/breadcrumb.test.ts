import { describe, it, expect } from "vitest";
import { injectBreadcrumbs } from "@/lib/documents/outline/breadcrumb";

describe("injectBreadcrumbs", () => {
  it("prepends heading path to chunk content", () => {
    const chunks = [
      {
        index: 0,
        title: "Architecture",
        content: "The system uses microservices.",
        tokenCount: 10,
        headingPath: "Platform > Architecture",
      },
    ];

    const result = injectBreadcrumbs(chunks);

    expect(result[0].content).toBe("[Platform > Architecture]\nThe system uses microservices.");
    expect(result[0].tokenCount).toBeGreaterThan(10);
  });

  it("does not add breadcrumb when headingPath is empty", () => {
    const chunks = [
      {
        index: 0,
        title: "Untitled",
        content: "Some content.",
        tokenCount: 5,
        headingPath: "",
      },
    ];

    const result = injectBreadcrumbs(chunks);
    expect(result[0].content).toBe("Some content.");
  });
});
