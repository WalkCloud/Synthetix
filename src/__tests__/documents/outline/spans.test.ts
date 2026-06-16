import { describe, it, expect } from "vitest";
import { buildAtomicSpans } from "@/lib/documents/outline/spans";

const docWithHeadings = `# Introduction

This is the first paragraph with some content about the project.

It continues here on a second line.

## Architecture

The system uses a microservice architecture with separate services.

### Service A

Service A handles authentication and authorization for all requests.

### Service B

Service B is responsible for data processing.

## Deployment

Deployment uses Kubernetes with Helm charts.

| Service | Port | Replicas |
|---------|------|----------|
| A       | 8080 | 3        |
| B       | 8081 | 2        |

## Security

Security is handled at multiple layers.
`;

const docWithoutHeadings = `This document describes the cloud platform architecture for a large enterprise system.

The platform provides full-stack cloud capabilities including unified user login, permission management, and integration with external identity providers.

Service Mesh is a core architecture component that manages microservice governance. It deploys to Kubernetes clusters to enable containerized service management.

Network policies control traffic flow between pods and namespaces. The system supports both ingress and egress rules.

Monitoring is handled through Prometheus and Grafana. Alert rules are configured for critical services.

The storage layer uses distributed storage with replication across multiple data centers. Backup strategies include daily incremental and weekly full backups.
`;

const docWithCodeBlock = `# API Reference

## Authentication

Authenticate using the token endpoint.

\`\`\`python
def authenticate(username: str, password: str) -> str:
    response = requests.post(
        "https://api.example.com/auth",
        json={"username": username, "password": password}
    )
    return response.json()["token"]
\`\`\`

## List Resources

Get a list of available resources.

\`\`\`bash
curl -H "Authorization: Bearer $TOKEN" \\
  https://api.example.com/resources
\`\`\`
`;

describe("buildAtomicSpans", () => {
  it("builds spans from document with headings", () => {
    const spans = buildAtomicSpans(docWithHeadings);

    expect(spans.length).toBeGreaterThan(0);

    const headings = spans.filter((s) => s.type === "heading");
    expect(headings.length).toBeGreaterThanOrEqual(4);
    expect(headings[0].text).toBe("Introduction");
    expect(headings[0].headingLevel).toBe(1);
    expect(headings[1].text).toBe("Architecture");
    expect(headings[1].headingLevel).toBe(2);

    const paragraphs = spans.filter((s) => s.type === "paragraph");
    expect(paragraphs.length).toBeGreaterThan(0);

    const tables = spans.filter((s) => s.type === "table");
    expect(tables.length).toBe(1);
    expect(tables[0].text).toContain("| Service | Port | Replicas |");

    for (const span of spans) {
      expect(span.id).toBeTruthy();
      expect(span.tokenCount).toBeGreaterThan(0);
      expect(span.type).toBeTruthy();
    }
  });

  it("builds spans from document without headings", () => {
    const spans = buildAtomicSpans(docWithoutHeadings);

    expect(spans.length).toBeGreaterThan(0);

    const headings = spans.filter((s) => s.type === "heading");
    expect(headings.length).toBe(0);

    const paragraphs = spans.filter((s) => s.type === "paragraph");
    expect(paragraphs.length).toBeGreaterThanOrEqual(5);

    for (const span of spans) {
      expect(span.id).toMatch(/^s_\d+$/);
      expect(span.tokenCount).toBeGreaterThan(0);
    }
  });

  it("builds spans from document with code blocks", () => {
    const spans = buildAtomicSpans(docWithCodeBlock);

    const codeBlocks = spans.filter((s) => s.type === "code");
    expect(codeBlocks.length).toBe(2);
    expect(codeBlocks[0].text).toContain("def authenticate");
    expect(codeBlocks[1].text).toContain("curl");
  });

  it("each span has monotonically increasing ids", () => {
    const spans = buildAtomicSpans(docWithHeadings);

    for (let i = 0; i < spans.length; i++) {
      expect(spans[i].id).toBe(`s_${String(i).padStart(4, "0")}`);
    }
  });

  it("handles empty document", () => {
    const spans = buildAtomicSpans("");

    expect(spans.length).toBe(0);
  });
});
