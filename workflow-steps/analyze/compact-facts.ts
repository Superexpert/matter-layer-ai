import type { CollapsedFact, CollapsedFieldValue } from "@/workflow-steps/extraction/collapsed-fact";
import type { ExtractedFactEvidence } from "@/workflow-steps/extraction/extracted-fact";

export type AnalyzeCitation = Pick<ExtractedFactEvidence,
  "documentId" | "documentName" | "pageStart" | "pageEnd" | "excerpt"
> & { citationId: string };

export type AnalyzeFactPacket = {
  facts: Array<{
    citations: AnalyzeCitation[];
    conflicts?: Array<{ field: string; values: Array<{ citations: AnalyzeCitation[]; value: unknown }> }>;
    factType: string;
    fields: Record<string, unknown>;
    status: CollapsedFact["status"];
    supportingValues?: Record<string, Array<{ citations: AnalyzeCitation[]; value: unknown }>>;
  }>;
  metadata: { collapsedFactCount: number; conflictingFactCount: number };
  profileId: string;
  sourceDocuments: Array<{ documentId: string; documentName: string }>;
};

function citationKey(value: Pick<ExtractedFactEvidence, "documentId" | "documentName" | "pageStart" | "pageEnd" | "excerpt">) {
  return JSON.stringify([value.documentId, value.documentName, value.pageStart, value.pageEnd, value.excerpt]);
}

function citations(values: ExtractedFactEvidence[], citationIdByKey: Map<string, string>) {
  return Array.from(new Map(values.map((value) => {
    const citation: AnalyzeCitation = {
      citationId: citationIdByKey.get(citationKey(value))!,
      documentId: value.documentId,
      documentName: value.documentName,
      ...(value.pageStart === undefined ? {} : { pageStart: value.pageStart }),
      ...(value.pageEnd === undefined ? {} : { pageEnd: value.pageEnd }),
      ...(value.excerpt ? { excerpt: value.excerpt } : {}),
    };
    return [citationKey(citation), citation];
  })).values()).sort((a, b) => citationKey(a).localeCompare(citationKey(b)));
}

function compactValue(value: CollapsedFieldValue, citationIdByKey: Map<string, string>) {
  return { citations: citations(value.evidence, citationIdByKey), value: value.value };
}

export function compactCollapsedFacts(input: {
  collapsedFacts: CollapsedFact[];
  profileId: string;
}): AnalyzeFactPacket {
  const evidence = input.collapsedFacts.flatMap((fact) => [
    ...fact.evidence,
    ...fact.conflicts.flatMap((conflict) => conflict.values.flatMap((value) => value.evidence)),
    ...Object.values(fact.supportingValues ?? {}).flatMap((values) => values.flatMap((value) => value.evidence)),
  ]);
  const citationIdByKey = new Map(
    [...new Set(evidence.map(citationKey))]
      .sort()
      .map((key, index) => [key, `citation-${index + 1}`]),
  );
  const facts = [...input.collapsedFacts]
    .sort((a, b) => a.factType.localeCompare(b.factType) || a.id.localeCompare(b.id))
    .map((fact) => ({
      citations: citations(fact.evidence, citationIdByKey),
      ...(fact.conflicts.length ? {
        conflicts: fact.conflicts.map((conflict) => ({
          field: conflict.field,
          values: conflict.values.map((value) => compactValue(value, citationIdByKey)),
        })),
      } : {}),
      factType: fact.factType,
      fields: structuredClone(fact.fields),
      status: fact.status,
      ...(fact.supportingValues && Object.keys(fact.supportingValues).length ? {
        supportingValues: Object.fromEntries(Object.entries(fact.supportingValues)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([field, values]) => [field, values.map((value) => compactValue(value, citationIdByKey))])),
      } : {}),
    }));
  const allCitations = facts.flatMap((fact) => fact.citations);
  const sourceDocuments = Array.from(new Map(allCitations.map((citation) => [
    citation.documentId,
    { documentId: citation.documentId, documentName: citation.documentName },
  ])).values()).sort((a, b) => a.documentName.localeCompare(b.documentName));
  return {
    facts,
    metadata: {
      collapsedFactCount: facts.length,
      conflictingFactCount: facts.filter((fact) => fact.status === "conflicting").length,
    },
    profileId: input.profileId,
    sourceDocuments,
  };
}
