export const OUTLINE_PROMPT = `Based on the conversation above, generate a complete document outline.

## Document Archetypes

Identify the document archetype from the conversation and use its structural skeleton as the foundation. Adapt the skeleton based on the conversation: add, remove, reorder, or rename sections as needed.

### A. technical_solution — Construction / Implementation Proposals
**Use when:** technical proposals, system construction plans, digital transformation, implementation plans
**Principle:** top-down, architecture-first, then details
**Skeleton:** Overview → Requirements Analysis → Overall Design → Detailed Design → Security & Operations → Implementation Plan → Training & Delivery
**Focus:** architecture diagrams, justified technology choices with versions, quantified performance metrics (concurrency, latency, availability)

### B. proposal — Justification / Approval Documents
**Use when:** project initiation reports, feasibility studies, investment proposals, funding requests
**Principle:** necessity first → feasibility → investment and benefits
**Skeleton:** Background & Necessity → Feasibility Analysis (technical / economic / operational) → Solution Overview → Investment Estimate → Benefit & Risk Analysis → Safeguards & Schedule
**Focus:** policy or data-backed necessity claims, quantified investment and benefits, mitigation plans for identified risks

### C. bidding — Bid / Tender Documents
**Use when:** bid technical proposals, tender technical documents, RFP responses, competitive bids
**Principle:** strict compliance with tender requirements, point-by-point response
**Skeleton:** Company Profile & Qualifications → Project Understanding & Requirements → Technical Solution (Overall + Detailed) → Project Implementation → After-Sales & Training → Reference Cases → Pricing (if applicable)
**Focus:** point-by-point alignment with scoring criteria, competitive differentiation, team credentials, actionable after-sales commitments

### D. consulting — Consulting / Research Reports
**Use when:** consulting reports, industry research, white papers, market analysis, due diligence
**Principle:** data-driven, analysis → insights → recommendations
**Skeleton:** Research Overview (purpose, scope, methodology) → Industry & Market Analysis → Current State Assessment & Benchmarking → Issue Diagnosis & Root Causes → Strategic Recommendations & Pathways → Implementation Roadmap → Risk Assessment
**Focus:** cited data with source and recency, established frameworks (SWOT, PESTEL, Porter Five Forces), actionable prioritized recommendations

### E. planning — Strategic Planning Documents
**Use when:** development plans, strategic plans, technology roadmaps, master plans, blueprints
**Principle:** vision to pathway, phased, prioritized. Near-term concrete, long-term aspirational.
**Skeleton:** Current State & Challenges → Vision & Strategic Goals → Overall Strategy → Key Initiatives & Priority Projects → Phased Roadmap (near / mid / long-term) → Safeguards & Resources
**Focus:** SMART objectives, clear phase differentiation, realistic resource allocation, measurable milestones

### F. assessment — Evaluation / Audit Reports
**Use when:** assessment reports, audits, compliance reviews, security evaluations, maturity assessments
**Principle:** standards first → item-by-item evaluation → traceable conclusions
**Skeleton:** Background & Scope → Evaluation Standards / Indicators → Methods & Tools → Itemized Findings → Overall Conclusion & Rating → Remediation Recommendations
**Focus:** explicit standard/criteria citations (with version/year), clear ratings/scores per item, prioritized actionable remediation

### G. operations — Operations / Management Documents
**Use when:** operations plans, management systems, emergency procedures, service-level agreements, runbooks
**Principle:** clear responsibilities → executable processes → emergency readiness
**Skeleton:** Overview & Scope → Organization & Responsibilities → Standard Procedures → Monitoring & Alerts → Emergency Response → Performance Review & Continuous Improvement
**Focus:** explicit process steps with role owners, tiered emergency response levels, measurable KPIs and SLAs

### H. general — General Professional Documents
**Use when:** technology selection reports, architecture design documents, test plans, interface specs, or any document not fitting the above archetypes
**Principle:** structure serves purpose, logical clarity, no forced template
**Skeleton:** construct freely based on the document purpose and conversation content
**Focus:** logical consistency, focused scope, avoid generic templates

### Hybrid Documents
When the document spans multiple archetypes (e.g., a bid that is also a technical proposal), identify it using "primary+secondary" format (e.g., "bidding+technical_solution"). Use the primary archetype's skeleton as the framework and embed key sections from the secondary archetype at appropriate positions.

---

## Generation Instructions

1. Identify the document archetype from the conversation. Use the matching skeleton as the structural foundation.
2. Adapt the skeleton based on the conversation's confirmed requirements:
   - Add sections for specific needs discussed
   - Remove sections that do not apply
   - Reorder sections if a different sequence better serves the document's purpose
   - Refine section titles to match the specific project context
3. For hybrid documents, merge skeletons: use the primary archetype's framework and embed key sections from the secondary archetype at logically appropriate positions.
4. Extract confirmed chapter divisions, key points, and constraints from the conversation.

## Output Requirements

1. Each section must include \`keyPoints\` (2-4), cannot be empty
2. Each section must include a concise \`description\` explaining the section's scope and role in the document
3. Each section must include \`writingRequirements\` — hidden drafting instructions: what to cover, angle, style, tone, boundaries with adjacent sections, what to avoid
4. Each section must include \`retrievalQuery\` (optimized knowledge-base search query) and \`referenceHints\` (entities, standards, frameworks, document types to look for)
5. Estimate \`estimatedWords\` per section based on content complexity
6. Multi-level headings with unlimited depth. Sections expected to exceed 800 words should be split into children
7. Num format reflects hierarchy: "1", "1.1", "1.1.1", "1.1.1.1", etc.
8. Leaf sections (deepest level) should each cover a coherent topic writable as a single unit

## Output JSON Schema

Output format is JSON (strictly follow, do not add any other text):

{
  "title": "Document Title",
  "documentType": "archetype identifier, e.g. 'technical_solution', 'proposal', 'bidding+technical_solution'",
  "sections": [
    {
      "num": "1",
      "title": "Chapter Name",
      "description": "One-sentence chapter scope and role in the document",
      "keyPoints": ["Point 1", "Point 2"],
      "estimatedWords": 1500,
      "writingRequirements": "Hidden drafting instruction: coverage, angle, boundaries, style, facts to look for, what to avoid",
      "retrievalQuery": "Search query optimized for retrieving supporting knowledge for this chapter",
      "referenceHints": ["entity/standard/framework 1", "entity/standard/framework 2"],
      "children": [
        {
          "num": "1.1",
          "title": "Sub-section Name",
          "description": "One-sentence sub-section scope",
          "keyPoints": ["Sub-point 1"],
          "estimatedWords": 500,
          "writingRequirements": "Hidden drafting instruction for this sub-section",
          "retrievalQuery": "Search query for this sub-section",
          "referenceHints": ["keyword 1", "keyword 2"],
          "children": [
            {"num": "1.1.1", "title": "Detail Name", "description": "Detail scope", "keyPoints": ["Detail point"], "estimatedWords": 250, "writingRequirements": "Hidden drafting instruction", "retrievalQuery": "Search query", "referenceHints": ["keyword"]}
          ]
        },
        {"num": "1.2", "title": "Sub-section Name", "description": "One-sentence sub-section scope", "keyPoints": ["Sub-point 1"], "estimatedWords": 600, "writingRequirements": "Hidden drafting instruction", "retrievalQuery": "Search query", "referenceHints": ["keyword"]}
      ]
    }
  ]
}

Ensure the outline comprehensively covers all topics discussed, with chapter ordering driven by the identified archetype.`;
