import type { ExtractedFact } from "../../extracted-fact";
import type { ExtractionWindowProgressEvent } from "../../types";
import type { ExtractionProfileContext } from "../../types";
import { buildChronologyPostprocessResult } from "./postprocess";
import { chronologyRunnerProfile, runChronologyExtraction } from "./extractor";
import type { ChronologyFact } from "./schema";

function pageRange(pageStart?: number, pageEnd?: number) {
  if (!pageStart) {
    return [1];
  }

  const end = pageEnd && pageEnd >= pageStart ? pageEnd : pageStart;

  return Array.from(
    { length: end - pageStart + 1 },
    (_unused, index) => pageStart + index,
  );
}

function optionalStringField(fact: ExtractedFact, fieldName: string) {
  const value = fact.fields[fieldName];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function splitNames(value: string | null) {
  if (!value) {
    return [];
  }

  return value.split(/[,;|]/).map((item) => item.trim()).filter(Boolean);
}

function chronologyFactFromExtractedFact(fact: ExtractedFact): ChronologyFact {
  const description = optionalStringField(fact, "description");

  if (!description) {
    throw new Error("DATED_EVENT facts require a description field.");
  }

  return {
    confidence: fact.extractionConfidence ?? "unknown",
    date: optionalStringField(fact, "date"),
    dateText: optionalStringField(fact, "date"),
    factType: "chronology_fact",
    id: fact.id,
    isApproximateDate: false,
    labels: ["compatibility-adapter", fact.factType],
    organizations: splitNames(optionalStringField(fact, "organizations")),
    people: splitNames(optionalStringField(fact, "people")),
    raw: fact,
    sortDate: optionalStringField(fact, "date"),
    sourceDocumentId: fact.evidence.documentId,
    sourceFileName: fact.evidence.documentName,
    sourcePages: pageRange(fact.evidence.pageStart, fact.evidence.pageEnd),
    sourceQuote: fact.evidence.excerpt ?? description,
    summary: description,
    timeText: null,
    warnings: [],
  };
}

export const chronologyExtractionProfile = {
  ...chronologyRunnerProfile,
  description: "Extract dated and undated chronology facts from selected documents.",
  id: "chronology",
  label: "Chronology",
  postProcess: (input: {
    items: ExtractedFact[];
  }) => {
    // Compatibility adapter: chronology collapse and artifact generation still
    // expect legacy ChronologyFact rows. Extraction itself now emits raw
    // declarative DATED_EVENT facts.
    const chronologyFacts = input.items
      .filter((fact) => fact.factType === "DATED_EVENT")
      .map(chronologyFactFromExtractedFact);
    const result = buildChronologyPostprocessResult(chronologyFacts);
    const factsByType = input.items.reduce<Record<string, number>>(
      (counts, fact) => ({
        ...counts,
        [fact.factType]: (counts[fact.factType] ?? 0) + 1,
      }),
      {},
    );

    return {
      artifactMetadata: {
        chronologyCompatibilityAdapter: "DATED_EVENT facts mapped to legacy chronology rows for collapse/artifact generation.",
        collapsedEventCount: result.collapsedEventCount,
        datedCollapsedEventCount: result.datedCollapsedEventCount,
        generatedFromFactCount: result.generatedFromFactCount,
        undatedCollapsedEventCount: result.undatedCollapsedEventCount,
      },
      artifacts: result.artifactMarkdown && result.collapsedEventCount > 0
        ? [
            {
              content: result.artifactMarkdown,
              metadataJson: {
                chronologyCompatibilityAdapter:
                  "DATED_EVENT facts mapped to legacy chronology rows for collapse/artifact generation.",
                collapsedEventCount: result.collapsedEventCount,
                datedEventCount: result.datedCollapsedEventCount,
                generatedFromFactCount: result.generatedFromFactCount,
                profile: "chronology",
                undatedEventCount: result.undatedCollapsedEventCount,
              },
              outputKey: "chronologyArtifactId",
              title: "Chronology",
            },
          ]
        : [],
      displayItems: input.items.map((fact) => ({ ...fact })),
      itemCount: input.items.length,
      itemCountsByType: factsByType,
      profileOutput: {
        chronologyCompatibilityAdapter:
          "DATED_EVENT facts mapped to legacy chronology rows for collapse/artifact generation.",
        collapsed: result,
        facts: input.items,
      },
      stepOutputPatch: {
        collapsedEventCount: result.collapsedEventCount,
        collapsedEvents: result.events.map((event) => ({ ...event })),
        extractedFactCount: input.items.length,
        facts: input.items.map((fact) => ({ ...fact })),
        factsByType,
      },
    };
  },
  run: runChronologyExtraction,
} as const;

export type ChronologyExtractionWindowProgressEvent =
  ExtractionWindowProgressEvent & {
    extractedFactCount?: number;
  };

export type ChronologyExtractionProfileContext = ExtractionProfileContext;
