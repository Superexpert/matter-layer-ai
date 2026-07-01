import type {
  ExtractionProfileContext,
  ExtractionWindowProgressEvent,
} from "../../types";
import { buildChronologyPostprocessResult } from "./postprocess";
import { chronologyRunnerProfile, runChronologyExtraction } from "./extractor";
import type { ChronologyFact } from "./schema";

export const chronologyExtractionProfile = {
  ...chronologyRunnerProfile,
  description: "Extract dated and undated chronology facts from selected documents.",
  id: "chronology",
  label: "Chronology",
  postProcess: (input: {
    items: ChronologyFact[];
  }) => {
    const result = buildChronologyPostprocessResult(input.items);

    return {
      artifactMetadata: {
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
                collapsedEventCount: result.collapsedEventCount,
                datedEventCount: result.datedCollapsedEventCount,
                generatedFromFactCount: result.generatedFromFactCount,
                profile: "chronology",
                undatedEventCount: result.undatedCollapsedEventCount,
              },
              outputKey: "chronologyArtifactId",
              title: "Chronology Draft",
            },
          ]
        : [],
      displayItems: result.facts.map((fact) => ({ ...fact })),
      itemCount: result.generatedFromFactCount,
      itemCountsByType: input.items.reduce<Record<string, number>>(
        (counts, fact) => ({
          ...counts,
          [fact.factType]: (counts[fact.factType] ?? 0) + 1,
        }),
        {
          chronology_fact: 0,
        },
      ),
      profileOutput: result,
      stepOutputPatch: {
        collapsedEventCount: result.collapsedEventCount,
        collapsedEvents: result.events.map((event) => ({ ...event })),
        extractedFactCount: result.generatedFromFactCount,
        facts: result.facts.map((fact) => ({ ...fact })),
        factsByType: input.items.reduce<Record<string, number>>(
          (counts, fact) => ({
            ...counts,
            [fact.factType]: (counts[fact.factType] ?? 0) + 1,
          }),
          {
            chronology_fact: 0,
          },
        ),
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
