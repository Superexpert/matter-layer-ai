import { describe, expect, it } from "vitest";

import { runExtractionProfile } from "../../workflow-steps/extraction/profile-runner";
import { condemnorAppraisalExtractionProfile } from "../../workflow-steps/extraction/profiles/appraisal";
import { APPRAISAL_REVIEW_RESPONSE_FORMAT, parseAppraisalReviewGeneratorOutput, renderCondemnorAppraisalReview } from "../../workflow-steps/analyze/appraisal-review";
import { compactCollapsedFacts } from "../../workflow-steps/analyze/compact-facts";
import type { CollapsedFact } from "../../workflow-steps/extraction/collapsed-fact";
import { markdownToEditorHtml } from "../../workflow-steps/document-editor/conversion";
import { collapseExtractedFacts } from "../../workflow-steps/extraction/identity";
import { builtInWorkflows, condemnorAppraisalReviewDefinition } from "../../workflows";

const evidence = { documentId: "appraisal-1", documentName: "Condemnor Appraisal.pdf", excerpt: "The total compensation opinion is $425,000.", pageEnd: 3, pageStart: 3 };
const collapsedFact: CollapsedFact = { conflicts: [], evidence: [evidence], factType: "APPRAISAL_VALUATION", fields: { concept: "total_compensation", numericValue: 425000, statedValue: "$425,000" }, id: "fact-1", identity: { matchedFields: ["concept"], ruleIndex: 0, strategy: "multiKey" }, identityKey: "total", sourceFactIds: ["raw-1"], status: "resolved" };

describe("Condemnor Appraisal Review", () => {
  it("registers an Eminent Domain built-in with the required step sequence", () => {
    expect(builtInWorkflows.find((workflow) => workflow.slug === "condemnor-appraisal-review")).toMatchObject({ builtInVersion: 1, isEnabledByDefault: true });
    expect(condemnorAppraisalReviewDefinition.category).toBe("Eminent Domain");
    expect(condemnorAppraisalReviewDefinition.steps.map((step) => step.type)).toEqual(["fileSelector", "extraction", "analyze", "reviewWorkProducts"]);
  });

  it("extracts cited valuation and comparable facts and rejects malformed output", async () => {
    const content = JSON.stringify({ facts: [
      { factType: "APPRAISAL_VALUATION", fields: { concept: "total_compensation", numericValue: 425000, statedValue: "$425,000" }, pageStart: 3, pageEnd: 3, sourceExcerpt: evidence.excerpt },
      { factType: "APPRAISAL_COMPARABLE_SALE", fields: { comparableId: "Comp 1", location: "Market corridor", salePrice: 900000, unitPrice: "$8.20/SF" }, pageStart: 4, pageEnd: 4, sourceExcerpt: "Comp 1 sold for $900,000." },
    ] });
    const result = await runExtractionProfile(condemnorAppraisalExtractionProfile, { aiService: { generateText: async () => ({ content, model: "fixture", provider: "fixture" }) }, readyDocuments: [{ fileName: evidence.documentName, id: evidence.documentId, markdown: "Appraisal fixture" }] });
    expect(result.status).toBe("COMPLETED");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ evidence: { documentId: evidence.documentId, pageStart: 3 } });
    await expect(runExtractionProfile(condemnorAppraisalExtractionProfile, { aiService: { generateText: async () => ({ content: "not json", model: "fixture", provider: "fixture" }) }, readyDocuments: [{ fileName: "bad.pdf", id: "bad", markdown: "bad" }] })).resolves.toMatchObject({ status: "FAILED" });
  });

  it("supports absent values by omission and preserves conflicting valuation candidates", async () => {
    const empty = await runExtractionProfile(condemnorAppraisalExtractionProfile, { aiService: { generateText: async () => ({ content: '{"facts":[]}', model: "fixture", provider: "fixture" }) }, readyDocuments: [{ fileName: "Abbreviated Appraisal.pdf", id: "empty", markdown: "No supported values." }] });
    expect(empty).toMatchObject({ itemCount: 0, status: "COMPLETED" });
    const conflicting = await runExtractionProfile(condemnorAppraisalExtractionProfile, { aiService: { generateText: async () => ({ content: JSON.stringify({ facts: [
      { factType: "APPRAISAL_VALUATION", fields: { concept: "remainder_damages", numericValue: 0, statedValue: "$0" }, sourceExcerpt: "Remainder damages are zero." },
      { factType: "APPRAISAL_VALUATION", fields: { concept: "remainder_damages", numericValue: 100000, statedValue: "$100,000" }, sourceExcerpt: "Remainder damages are $100,000." },
    ] }), model: "fixture", provider: "fixture" }) }, readyDocuments: [{ fileName: "Conflicting Appraisal.pdf", id: "conflict", markdown: "Conflicting values." }] });
    const collapse = collapseExtractedFacts({ factDefs: condemnorAppraisalExtractionProfile.factDefs, facts: conflicting.items, profileId: condemnorAppraisalExtractionProfile.id });
    expect(collapse.collapsedFacts[0]).toMatchObject({ status: "conflicting" });
    expect(collapse.collapsedFacts[0]?.conflicts.length).toBeGreaterThan(0);
  });

  it("validates structured rows and deterministically renders tables with citations", () => {
    expect(APPRAISAL_REVIEW_RESPONSE_FORMAT.type).toBe("json_schema");
    expect(() => parseAppraisalReviewGeneratorOutput('{"summary":1,"items":[]}')).toThrow("invalid");
    const packet = compactCollapsedFacts({ collapsedFacts: [collapsedFact], profileId: "condemnor-appraisal-review" });
    const citationId = packet.facts[0]!.citations[0]!.citationId;
    const output = { summary: "Summary", items: [{ basis: "Before-and-after analysis", citationIds: [citationId], conclusion: "$425,000", issue: "Total Compensation", notes: "Confirm calculation support." }] };
    const markdown = renderCondemnorAppraisalReview({ packet, results: { "executive-summary": output, "valuation-summary": output, "assumptions-impacts": output, "comparable-sales": output, "missing-evidence-questions": output } });
    expect(markdown).toContain("| Issue | Appraiser Conclusion | Supporting Basis | Review Notes |");
    expect(markdown).toContain('data-citation-source-document-id="appraisal-1"');
    expect(markdown).toContain("not an independent appraisal");
    expect(markdown).not.toContain("professionally noncompliant");
    expect(markdown).not.toContain("legally compensable");
    expect(markdownToEditorHtml(markdown)).toContain("<table>");
  });
});
