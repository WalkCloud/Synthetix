import { describe, it, expect } from "vitest";
import { buildAuditPrompt, parseAuditResponse } from "@/lib/writing/audit";

describe("buildAuditPrompt", () => {
  it("returns system and user prompts with title and keyPoints", () => {
    const { system, user } = buildAuditPrompt("Test Section", "some content", "accuracy, completeness");
    expect(system).toContain("document quality auditor");
    expect(system).toContain("reference_exposure");
    expect(user).toContain("Test Section");
    expect(user).toContain("some content");
    expect(user).toContain("accuracy, completeness");
  });

  it("handles null keyPoints", () => {
    const { user } = buildAuditPrompt("Title", "content", null);
    expect(user).toContain("Not specified");
  });

  it("truncates content to 4000 characters", () => {
    const longContent = "x".repeat(5000);
    const { user } = buildAuditPrompt("Title", longContent, null);
    expect(user).toContain("## Section Title");
    expect(user).toContain("## Section Content");
    expect(user).toContain("Not specified");
    const contentStart = user.indexOf("## Section Content\n") + "## Section Content\n".length;
    const keyPointsStart = user.indexOf("\n\n## Key Points Expected");
    const contentPart = user.slice(contentStart, keyPointsStart);
    expect(contentPart.length).toBeLessThanOrEqual(4000);
  });
});

describe("parseAuditResponse", () => {
  it("parses a valid passed response", () => {
    const json = JSON.stringify({ passed: true, score: 95, issues: [] });
    const result = parseAuditResponse(json);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(95);
    expect(result.issues).toEqual([]);
    expect(result.checkedAt).toBeDefined();
  });

  it("parses a failed response with issues", () => {
    const json = JSON.stringify({
      passed: false,
      score: 60,
      issues: [
        { rule: "ai_signatures", severity: "critical", detail: "Found 'delve'", excerpt: "delve into..." },
        { rule: "empty_filler", severity: "warning", detail: "Found 'robust'", excerpt: "robust platform" },
      ],
    });
    const result = parseAuditResponse(json);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(60);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0].rule).toBe("ai_signatures");
    expect(result.issues[0].severity).toBe("critical");
  });

  it("filters out issues missing rule or detail", () => {
    const json = JSON.stringify({
      passed: false,
      score: 80,
      issues: [
        { rule: "valid", severity: "warning", detail: "ok" },
        { rule: "", severity: "warning", detail: "no rule" },
        { rule: "no-detail", severity: "warning", detail: "" },
      ],
    });
    const result = parseAuditResponse(json);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].rule).toBe("valid");
  });

  it("stays failed when passed:false even without critical issues", () => {
    const json = JSON.stringify({
      passed: false,
      score: 90,
      issues: [{ rule: "paragraph_length", severity: "warning", detail: "short paragraph" }],
    });
    const result = parseAuditResponse(json);
    expect(result.passed).toBe(false);
  });

  it("returns failed result on invalid JSON", () => {
    const result = parseAuditResponse("not json at all");
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].rule).toBe("audit_parse_error");
  });

  it("extracts JSON from text with surrounding content", () => {
    const result = parseAuditResponse('Some text\n{"passed": true, "score": 100, "issues": []}\nMore text');
    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
  });

  it("clamps score to 0-100 range", () => {
    expect(parseAuditResponse(JSON.stringify({ passed: true, score: 150, issues: [] })).score).toBe(100);
    expect(parseAuditResponse(JSON.stringify({ passed: false, score: -10, issues: [] })).score).toBe(0);
  });
});
