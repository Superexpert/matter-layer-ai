import { Prisma, WorkflowExtractionRunStatus } from "@prisma/client";

import type { ChronologyExtractionProfileContext } from ".";
import { buildChronologyUserPrompt, chronologySystemPrompt } from "./prompts";
import {
  countFactsByType,
  parseChronologyExtractionOutput,
  type ChronologyFact,
} from "./schema";
import { createChronologyMarkdownWindows } from "./windowing";

export type ChronologyExtractionResult = {
  error: string | null;
  extractedFactCount: number;
  extractionWindowCount: number;
  factsByType: Record<string, number>;
  failedWindowCount: number;
  provider: string | null;
  model: string | null;
  status: WorkflowExtractionRunStatus;
};

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function conciseError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 1000);
  }

  return "Chronology extraction failed.";
}

function statusForResult(input: {
  extractedFactCount: number;
  failedWindowCount: number;
  totalWindowCount: number;
}) {
  if (input.totalWindowCount === 0) {
    return WorkflowExtractionRunStatus.FAILED;
  }

  if (input.failedWindowCount === 0) {
    return WorkflowExtractionRunStatus.COMPLETED;
  }

  if (input.extractedFactCount > 0 || input.failedWindowCount < input.totalWindowCount) {
    return WorkflowExtractionRunStatus.PARTIAL_FAILED;
  }

  return WorkflowExtractionRunStatus.FAILED;
}

function factCreateInput(input: {
  extractionRunId: string;
  fact: ChronologyFact;
  matterId: string;
  stepId: string;
  workflowRunId: string;
}) {
  return {
    confidence: input.fact.confidence,
    dataJson: jsonValue(input.fact),
    extractionRunId: input.extractionRunId,
    factType: input.fact.factType,
    matterDocumentId: input.fact.sourceDocumentId,
    matterId: input.matterId,
    sourcePagesJson: jsonValue(input.fact.sourcePages),
    sourceQuote: input.fact.sourceQuote,
    stepId: input.stepId,
    workflowRunId: input.workflowRunId,
  };
}

export async function runChronologyExtraction(
  context: ChronologyExtractionProfileContext,
): Promise<ChronologyExtractionResult> {
  const windows = context.readyDocuments.flatMap((document) =>
    createChronologyMarkdownWindows({
      documentId: document.id,
      fileName: document.fileName,
      markdown: document.markdown,
    }),
  );
  const facts: ChronologyFact[] = [];
  const errors: string[] = [];
  let provider: string | null = null;
  let model: string | null = null;

  await context.prisma.extractedFact.deleteMany({
    where: {
      extractionRunId: context.extractionRunId,
    },
  });

  for (const window of windows) {
    try {
      const response = await context.aiService.generateText({
        maxOutputTokens: 6000,
        messages: [
          {
            content: chronologySystemPrompt,
            role: "system",
          },
          {
            content: buildChronologyUserPrompt(window),
            role: "user",
          },
        ],
      });
      const parsed = parseChronologyExtractionOutput(response.content);
      const windowFacts = parsed.facts.filter(
        (fact) =>
          fact.sourceDocumentId === window.documentId &&
          fact.sourceFileName === window.fileName,
      );

      provider = response.provider;
      model = response.model;
      facts.push(...windowFacts);
    } catch (error) {
      errors.push(
        `Window ${window.windowIndex + 1} for ${window.fileName}: ${conciseError(error)}`,
      );
    }
  }

  if (facts.length > 0) {
    await context.prisma.extractedFact.createMany({
      data: facts.map((fact) =>
        factCreateInput({
          extractionRunId: context.extractionRunId,
          fact,
          matterId: context.matterId,
          stepId: context.stepId,
          workflowRunId: context.workflowRunId,
        }),
      ),
    });
  }

  const status = statusForResult({
    extractedFactCount: facts.length,
    failedWindowCount: errors.length,
    totalWindowCount: windows.length,
  });
  const factsByType = countFactsByType(facts);

  return {
    error: errors[0] ?? null,
    extractedFactCount: facts.length,
    extractionWindowCount: windows.length,
    factsByType,
    failedWindowCount: errors.length,
    model,
    provider,
    status,
  };
}
