import { describe, expect, it } from "vitest";
import {
  compareTaskIdentitySources,
  parseLegacyTaskIdentity,
} from "@/lib/queue/task-identity-legacy";

describe("parseLegacyTaskIdentity", () => {
  it("parses document, session, and draft task identities", () => {
    expect(parseLegacyTaskIdentity({
      type: "document_convert",
      inputData: JSON.stringify({ docId: "doc-1" }),
    })).toMatchObject({
      status: "parsed",
      identity: { documentId: "doc-1", attempt: 0 },
    });
    expect(parseLegacyTaskIdentity({
      type: "outline_generate",
      inputData: JSON.stringify({ sessionId: "session-1" }),
    })).toMatchObject({
      status: "parsed",
      identity: { sessionId: "session-1", attempt: 0 },
    });
    expect(parseLegacyTaskIdentity({
      type: "draft_generate_all",
      inputData: JSON.stringify({ draftId: "draft-1" }),
    })).toMatchObject({
      status: "parsed",
      identity: { draftId: "draft-1", attempt: 0 },
    });
  });

  it("returns null for missing input without inventing identity", () => {
    expect(parseLegacyTaskIdentity({ type: "document_convert", inputData: null }).status).toBe("null");
    expect(parseLegacyTaskIdentity({ type: "unknown_task", inputData: "{}" }).status).toBe("null");
  });

  it("marks invalid persisted payloads as malformed", () => {
    expect(parseLegacyTaskIdentity({ type: "document_convert", inputData: "{" }).status).toBe("malformed");
    expect(parseLegacyTaskIdentity({ type: "document_convert", inputData: "[]" }).status).toBe("malformed");
    expect(parseLegacyTaskIdentity({
      type: "document_convert",
      inputData: JSON.stringify({ docId: 17 }),
    }).status).toBe("malformed");
    expect(parseLegacyTaskIdentity({
      type: "rag_index",
      inputData: JSON.stringify({ docId: "doc-1", options: { _graphAttempt: "2" } }),
    }).status).toBe("malformed");
  });

  it("marks multiple or conflicting resource identities as ambiguous", () => {
    expect(parseLegacyTaskIdentity({
      type: "document_convert",
      inputData: JSON.stringify({ docId: "doc-1", draftId: "draft-1" }),
    }).status).toBe("ambiguous");
    expect(parseLegacyTaskIdentity({
      type: "outline_generate",
      inputData: JSON.stringify({ sessionId: "session-1", docId: "doc-1" }),
    }).status).toBe("ambiguous");
  });

  it("parses graph retry attempts and defaults the first attempt to zero", () => {
    expect(parseLegacyTaskIdentity({
      type: "rag_index",
      inputData: JSON.stringify({ docId: "doc-1" }),
    }).identity.attempt).toBe(0);
    expect(parseLegacyTaskIdentity({
      type: "rag_index",
      inputData: JSON.stringify({ docId: "doc-1", options: { _graphAttempt: 2 } }),
    }).identity.attempt).toBe(2);
  });
});

describe("compareTaskIdentitySources", () => {
  it("keeps populated relational values authoritative and reports mismatch", () => {
    const comparison = compareTaskIdentitySources({
      type: "document_convert",
      inputData: JSON.stringify({ docId: "doc-legacy" }),
      documentId: "doc-relational",
      draftId: null,
      sectionId: null,
      sessionId: null,
      attempt: 0,
    });

    expect(comparison.authoritative.documentId).toBe("doc-relational");
    expect(comparison.mismatches).toEqual([{
      field: "documentId",
      relational: "doc-relational",
      legacy: "doc-legacy",
    }]);
  });

  it("uses reliable legacy values only when relational fields are null", () => {
    const comparison = compareTaskIdentitySources({
      type: "rag_index",
      inputData: JSON.stringify({ docId: "doc-legacy", options: { _graphAttempt: 2 } }),
      documentId: null,
      draftId: null,
      sectionId: null,
      sessionId: null,
      attempt: null,
    });

    expect(comparison.authoritative.documentId).toBe("doc-legacy");
    expect(comparison.authoritative.attempt).toBe(2);
    expect(comparison.mismatches).toEqual([]);
  });
});
