import { describe, expect, it } from "vitest";

import { compactCollapsedFacts } from "../../workflow-steps/analyze/compact-facts";
import { analyzeGeneratorMessages } from "../../workflow-steps/analyze/generators";
import { normalizeGeneratedWorkProduct } from "../../workflow-steps/analyze/work-product-citations";
import { normalizeAnalyzeStepConfig } from "../../workflow-steps/analyze/schema";
import { workflowStepRegistry } from "../../services/workflows/registry";
import type { CollapsedFact } from "../../workflow-steps/extraction/collapsed-fact";

const evidence = { documentId: "doc-1", documentName: "Petition.pdf", excerpt: "The petition was filed.", pageEnd: 3, pageStart: 3 };

function fact(): CollapsedFact {
  return {
    conflicts: [{ field: "deadline", values: [{ evidence: [evidence], normalizedValue: "2026-05-01", sourceFactIds: ["raw-1"], value: "May 1, 2026" }, { evidence: [evidence], normalizedValue: "2026-05-02", sourceFactIds: ["raw-2"], value: "May 2, 2026" }] }],
    evidence: [evidence, evidence], factType: "EVENT",
    fields: { eventDate: "2026-03-18", eventType: "petition-filed" },
    id: "collapsed-1", identity: { matchedFields: ["eventType", "eventDate"], ruleIndex: 0, strategy: "multiKey" },
    identityKey: "internal-key", sourceFactIds: ["raw-1", "raw-2"], status: "conflicting",
    supportingValues: { description: [{ evidence: [evidence], sourceFactIds: ["raw-1"], value: "The City filed its petition." }] },
  };
}

describe("Analyze workflow step", () => {
  it("registers Analyze", () => expect(workflowStepRegistry.analyze.type).toBe("analyze"));

  it("normalizes a serializable generator configuration", () => {
    const config = normalizeAnalyzeStepConfig({ generators: [{ id: "memo", instructions: "Write it.", name: "Memo", outputName: "Memo" }], inputStepId: "extract", model: "gpt-5.5" });
    expect(JSON.parse(JSON.stringify(config))).toEqual(config);
    expect(config.generators[0]).not.toHaveProperty("provider");
  });

  it("requires generators, unique IDs, instructions, and input", () => {
    expect(() => normalizeAnalyzeStepConfig({ generators: [], inputStepId: "extract" })).toThrow("at least one");
    expect(() => normalizeAnalyzeStepConfig({ generators: [{ id: "memo", instructions: "x", name: "Memo", outputName: "Memo" }, { id: "memo", instructions: "x", name: "Other", outputName: "Other" }], inputStepId: "extract" })).toThrow("unique");
    expect(() => normalizeAnalyzeStepConfig({ generators: [{ id: "memo", instructions: "", name: "Memo", outputName: "Memo" }], inputStepId: "extract" })).toThrow("instructions");
    expect(() => normalizeAnalyzeStepConfig({ generators: [{ id: "memo", instructions: "x", name: "Memo", outputName: "Memo" }] })).toThrow("inputStepId");
  });

  it("compacts deterministically without identity diagnostics and deduplicates citations", () => {
    const first = compactCollapsedFacts({ collapsedFacts: [fact()], profileId: "eminent-domain-facts" });
    expect(first).toEqual(compactCollapsedFacts({ collapsedFacts: [fact()], profileId: "eminent-domain-facts" }));
    expect(first.facts[0]).not.toHaveProperty("identityKey");
    expect(first.facts[0]).not.toHaveProperty("sourceFactIds");
    expect(first.facts[0]?.fields.eventDate).toBe("2026-03-18");
    expect(first.facts[0]?.conflicts?.[0]?.values).toHaveLength(2);
    expect(first.facts[0]?.supportingValues?.description).toHaveLength(1);
    expect(first.facts[0]?.citations).toEqual([{ citationId: "citation-1", ...evidence }]);
    expect(first.sourceDocuments).toEqual([{ documentId: "doc-1", documentName: "Petition.pdf" }]);
  });

  it("expands multiple stable citation IDs into authoritative citation nodes", () => {
    const secondEvidence = { documentId: "doc-2", documentName: "Hearing Notice.pdf", excerpt: "The hearing is set for June 2.", pageEnd: 4, pageStart: 4 };
    const secondFact = fact();
    secondFact.evidence = [evidence, secondEvidence];
    const packet = compactCollapsedFacts({ collapsedFacts: [secondFact], profileId: "generic" });
    const citationIds = packet.facts[0]!.citations.map((citation) => citation.citationId);
    const markdown = normalizeGeneratedWorkProduct({
      packet,
      responseContent: JSON.stringify({ markdown: `Supported sentence ${citationIds.map((id) => `{{ml-citation:${id}}}`).join(" ")}.` }),
    });
    expect(markdown.match(/data-ml-citation="true"/g)).toHaveLength(2);
    expect(markdown).toContain('data-citation-source-document-id="doc-1"');
    expect(markdown).toContain('data-citation-source-document-id="doc-2"');
    expect(markdown).toContain('data-citation-cited-text="The hearing is set for June 2."');
    expect(markdown).not.toContain("{{ml-citation:");
    expect(() => normalizeGeneratedWorkProduct({ packet, responseContent: JSON.stringify({ markdown: "Bad {{ml-citation:citation-999}}" }) })).toThrow("unknown evidence");
  });

  it("gives a generator only its own instructions", () => {
    const packet = compactCollapsedFacts({ collapsedFacts: [fact()], profileId: "eminent-domain-facts" });
    const messages = analyzeGeneratorMessages({ generator: { id: "memo", instructions: "Memo-only instruction", name: "Memo", outputName: "Memo" }, packet });
    expect(messages[1]?.content).toContain("Memo-only instruction");
    expect(messages[1]?.content).toContain(JSON.stringify(packet));
    expect(messages[1]?.content).not.toContain("Client-only instruction");
    expect(messages[1]?.content).not.toContain('data-citation-label="Document p. 1"');
    expect(messages[1]?.content).toContain("{{ml-citation:CITATION_ID}}");
  });
});
