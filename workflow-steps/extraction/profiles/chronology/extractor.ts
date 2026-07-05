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

const chronologyFactJsonSchema = {
  additionalProperties: false,
  properties: {
    facts: {
      items: {
        additionalProperties: false,
        properties: {
          confidence: {
            type: ["string", "null"],
          },
          date: {
            type: ["string", "null"],
          },
          dateText: {
            type: ["string", "null"],
          },
          timeText: {
            type: ["string", "null"],
          },
          labels: {
            items: {
              type: "string",
            },
            type: "array",
          },
          organizations: {
            items: {
              type: "string",
            },
            type: "array",
          },
          people: {
            items: {
              type: "string",
            },
            type: "array",
          },
          sourceDocumentId: {
            type: "string",
          },
          sourceFileName: {
            type: "string",
          },
          sourcePages: {
            items: {
              type: "number",
            },
            type: "array",
          },
          sourceQuote: {
            type: "string",
          },
          summary: {
            type: "string",
          },
        },
        required: [
          "date",
          "dateText",
          "timeText",
          "summary",
          "people",
          "organizations",
          "sourceDocumentId",
          "sourceFileName",
          "sourcePages",
          "sourceQuote",
          "confidence",
          "labels",
        ],
        type: "object",
      },
      type: "array",
    },
  },
  required: ["facts"],
  type: "object",
} satisfies Record<string, unknown>;

const chronologyJsonRepairInstructions = [
  "Return a JSON object with exactly this top-level shape:",
  "{\"facts\":[{\"date\":\"YYYY-MM-DD|null\",\"dateText\":\"source date text|null\",\"timeText\":\"source time text|null\",\"summary\":\"what happened\",\"people\":[\"person names\"],\"organizations\":[\"organization names\"],\"sourceDocumentId\":\"document id\",\"sourceFileName\":\"file name\",\"sourcePages\":[1],\"sourceQuote\":\"exact supporting quote\",\"confidence\":\"high|medium|low|unknown\",\"labels\":[\"optional labels\"]}]}",
  "Use null for unknown dates.",
  "Use null for unknown times.",
  "Use empty arrays for people, organizations, or labels when none are listed.",
  "Every fact must include sourceDocumentId, sourceFileName, sourcePages, and sourceQuote.",
].join("\n");

export const chronologyRunnerProfile = {
  buildUserPrompt: buildChronologyUserPrompt,
  createWindows: createChronologyMarkdownWindows,
  description: "Extract dated and undated chronology facts from selected documents.",
  id: "chronology",
  itemLabel: "chronology fact",
  itemPluralLabel: "chronology facts",
  jsonRepairInstructions: chronologyJsonRepairInstructions,
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
  responseFormat: {
    name: "chronology_extraction",
    schema: chronologyFactJsonSchema,
    type: "json_schema",
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
