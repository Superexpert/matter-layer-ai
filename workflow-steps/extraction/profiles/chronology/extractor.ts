import { createFactExtractionProfile } from "../../generic-fact-profile";
import type { ExtractedFact } from "../../extracted-fact";
import type {
  ExtractionProfileContext,
  ExtractionProfileRunResult,
} from "../../types";
import type { FactDef } from "../../fact-def";
import { createChronologyMarkdownWindows } from "./windowing";

export const chronologyFactDefs = [
  {
    description: "A dated or undated event suitable for a legal chronology.",
    extraction: {
      fields: [
        {
          description: "Normalized YYYY-MM-DD date when available.",
          name: "date",
          required: false,
          type: "date",
        },
        {
          description: "Concise factual sentence describing what happened.",
          name: "description",
          required: true,
          type: "string",
        },
        {
          description: "People involved, as stated in the source.",
          name: "people",
          required: false,
          type: "string",
        },
        {
          description: "Organizations involved, as stated in the source.",
          name: "organizations",
          required: false,
          type: "string",
        },
      ],
      instructions:
        "Extract facts that belong in a legal chronology: things that happened, important document events, or legally meaningful undated facts. Avoid footer dates, print dates, boilerplate dates, and unrelated citation dates.",
    },
    factType: "DATED_EVENT",
  },
] satisfies FactDef[];

export type ChronologyExtractionResult = ExtractionProfileRunResult<ExtractedFact> & {
  extractedFactCount: number;
  extractionWarnings: ExtractionProfileRunResult<ExtractedFact>["warnings"];
  extractionWindowCount: number;
  facts: ExtractedFact[];
  factsByType: Record<string, number>;
};

export const chronologyRunnerProfile = createFactExtractionProfile({
  createWindows: createChronologyMarkdownWindows,
  description: "Extract dated and undated chronology facts from selected documents.",
  factDefs: chronologyFactDefs,
  id: "chronology",
  itemLabel: "chronology fact",
  itemPluralLabel: "chronology facts",
  label: "Chronology",
  maxOutputTokens: 6000,
  profileInstructions: [
    "Extract sourced chronology facts for legal case preparation.",
    "Each fact should describe one event or factual occurrence.",
    "Preserve source page numbers from <!-- ml:page {\"page\":n} --> markers when available.",
    "Use the whole provided window; facts may begin on one page and continue on the next.",
    "Do not generate final chronology prose.",
  ].join("\n"),
});

export async function runChronologyExtraction(
  context: ExtractionProfileContext,
): Promise<ChronologyExtractionResult> {
  const result = await import("../../profile-runner").then(({ runExtractionProfile }) =>
    runExtractionProfile(chronologyRunnerProfile, context),
  );

  return {
    ...result,
    extractedFactCount: result.itemCount,
    extractionWarnings: result.warnings,
    extractionWindowCount: result.windowCount,
    facts: result.items,
    factsByType: result.itemCountsByType,
  };
}
