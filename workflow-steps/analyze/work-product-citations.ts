import type { AnalyzeFactPacket, AnalyzeCitation } from "./compact-facts";
import { citationMarkdown } from "@/workflow-steps/document-editor/citations";

export const ANALYZE_WORK_PRODUCT_RESPONSE_FORMAT = {
  name: "analyze_work_product",
  schema: {
    additionalProperties: false,
    properties: { markdown: { type: "string" } },
    required: ["markdown"],
    type: "object",
  },
  type: "json_schema" as const,
};

const CITATION_TOKEN = /\{\{ml-citation:([a-z0-9-]+)\}\}/g;

function citationIndex(packet: AnalyzeFactPacket) {
  const citations = packet.facts.flatMap((fact) => [
    ...fact.citations,
    ...(fact.conflicts ?? []).flatMap((conflict) => conflict.values.flatMap((value) => value.citations)),
    ...Object.values(fact.supportingValues ?? {}).flatMap((values) => values.flatMap((value) => value.citations)),
  ]);
  return new Map(citations.map((citation) => [citation.citationId, citation]));
}

function citationNode(citation: AnalyzeCitation) {
  return citationMarkdown({
    citedText: citation.excerpt,
    pageEnd: citation.pageEnd,
    pageStart: citation.pageStart,
    sourceDocumentId: citation.documentId,
    sourceDocumentName: citation.documentName,
  });
}

export function normalizeGeneratedWorkProduct(input: {
  packet: AnalyzeFactPacket;
  responseContent: string;
}) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.responseContent);
  } catch {
    throw new Error("Analyze generator did not return structured work-product JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      Object.keys(parsed).length !== 1 || typeof (parsed as { markdown?: unknown }).markdown !== "string") {
    throw new Error("Analyze generator returned an invalid work-product structure.");
  }
  const markdown = (parsed as { markdown: string }).markdown.trim();
  if (!markdown) throw new Error("Analyze generator returned empty Markdown.");
  const citations = citationIndex(input.packet);
  return markdown.replace(CITATION_TOKEN, (_token, citationId: string) => {
    const citation = citations.get(citationId);
    if (!citation) throw new Error(`Analyze generator cited unknown evidence: ${citationId}`);
    return citationNode(citation);
  });
}
