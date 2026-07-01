import { runExtractionProfile } from "../../profile-runner";
import type {
  ExtractionProfile,
  ExtractionProfileContext,
  ExtractionProfileRunResult,
} from "../../types";
import { buildChronologyUserPrompt, chronologySystemPrompt } from "./prompts";
import {
  countFactsByType,
  parseChronologyExtractionOutput,
  type ChronologyFact,
} from "./schema";
import { createChronologyMarkdownWindows } from "./windowing";

export type ChronologyExtractionResult = ExtractionProfileRunResult<ChronologyFact> & {
  extractedFactCount: number;
  extractionWarnings: ExtractionProfileRunResult<ChronologyFact>["warnings"];
  extractionWindowCount: number;
  facts: ChronologyFact[];
  factsByType: Record<string, number>;
};

export const chronologyRunnerProfile = {
  buildUserPrompt: buildChronologyUserPrompt,
  createWindows: createChronologyMarkdownWindows,
  description: "Extract dated and undated chronology facts from selected documents.",
  id: "chronology",
  itemLabel: "chronology fact",
  itemPluralLabel: "chronology facts",
  label: "Chronology",
  maxOutputTokens: 6000,
  parseModelOutput: (content: string, context) => {
    const parsed = parseChronologyExtractionOutput(content, {
      sourceDocumentId: context.window.documentId,
      sourceFileName: context.window.fileName,
      sourcePages: [context.window.pageStart ?? 1],
    });
    const facts = parsed.facts.filter(
      (fact) =>
        fact.sourceDocumentId === context.window.documentId &&
        fact.sourceFileName === context.window.fileName,
    );

    return {
      itemCountsByType: countFactsByType(facts),
      items: facts,
      warnings: parsed.warnings,
    };
  },
  systemPrompt: chronologySystemPrompt,
} satisfies ExtractionProfile<ChronologyFact>;

export async function runChronologyExtraction(
  context: ExtractionProfileContext,
): Promise<ChronologyExtractionResult> {
  const result = await runExtractionProfile(chronologyRunnerProfile, context);

  return {
    ...result,
    extractedFactCount: result.itemCount,
    extractionWarnings: result.warnings,
    extractionWindowCount: result.windowCount,
    facts: result.items,
    factsByType: result.itemCountsByType,
  };
}
