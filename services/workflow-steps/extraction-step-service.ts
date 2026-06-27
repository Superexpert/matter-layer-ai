import "server-only";

import {
  MatterDocumentRepresentationStatus,
  MatterDocumentRepresentationType,
  Prisma,
  WorkflowExtractionRunStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { ensureMatterDocumentRepresentation } from "@/services/matter-documents/representations";
import { createWorkflowMarkdownArtifact } from "@/services/workflows/workflow-artifact-service";
import {
  readWorkflowStepOutput,
  toWorkflowJsonValue,
  writeWorkflowStepOutput,
} from "@/services/workflows/workflow-step-output-service";
import type { WorkflowStepDefinition } from "@/services/workflows/types";
import { extractionRepresentationDisplayState } from "@/workflow-steps/extraction/display-state";
import { getExtractionProfile } from "@/workflow-steps/extraction/profiles";
import { buildChronologyPostprocessResult } from "@/workflow-steps/extraction/profiles/chronology/postprocess";
import {
  normalizeExtractionStepConfig,
  type ExtractionStepOutput,
} from "@/workflow-steps/extraction/schema";
import {
  documentRepresentationError,
  extractionProviderError,
  extractionStepErrorForDocuments,
} from "@/workflow-steps/extraction/errors";
import type { WorkflowStepError } from "@/services/workflows/workflow-step-errors";

export type ExtractionDocumentState = {
  error: string | null;
  fileName: string;
  id: string;
  mimeType: string;
  representationStatus: "Failed" | "Not started" | "Processing" | "Ready";
};

type SelectedDocument = {
  fileName: string;
  id: string;
  mimeType: string;
};

export type ExtractionStepState = {
  documents: ExtractionDocumentState[];
  latestOutput: ExtractionStepOutput | null;
  latestRunStatus: string | null;
};

export type RunExtractionStepInput = {
  aiService?: {
    generateText: (request: {
      maxOutputTokens?: number;
      messages: Array<{ content: string; role: "assistant" | "system" | "user" }>;
      temperature?: number;
    }) => Promise<{
      content: string;
      model: string;
      provider: string;
    }>;
  };
  executionMode?: "autorun" | "manual";
  matterId: string;
  step: WorkflowStepDefinition;
  workflowDefinitionId: string;
  workflowRunId: string;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function selectedIdsFromOutputJson(value: Prisma.JsonValue | null | undefined) {
  if (!isObjectRecord(value)) {
    return [];
  }

  if (!Array.isArray(value.selectedMatterDocumentIds)) {
    return [];
  }

  return value.selectedMatterDocumentIds.filter(
    (documentId): documentId is string => typeof documentId === "string",
  );
}

function outputStatusFromRunStatus(status: WorkflowExtractionRunStatus) {
  if (status === WorkflowExtractionRunStatus.COMPLETED) {
    return "completed" satisfies ExtractionStepOutput["status"];
  }

  if (status === WorkflowExtractionRunStatus.PARTIAL_FAILED) {
    return "partial_failed" satisfies ExtractionStepOutput["status"];
  }

  return "failed" satisfies ExtractionStepOutput["status"];
}

function emptyFactsByType() {
  return {
    dated_event: 0,
    document_date: 0,
    organization: 0,
    person: 0,
    undated_event: 0,
  };
}

function failedOutput(input: {
  error: WorkflowStepError;
  extractionRunId: string;
  failedRepresentationCount: number;
  profile: "chronology";
  readyRepresentationCount: number;
  selectedMatterDocumentIds: string[];
}): ExtractionStepOutput {
  return {
    chronologyArtifactId: null,
    collapsedEventCount: 0,
    collapsedEvents: [],
    error: input.error,
    extractedFactCount: 0,
    extractionRunId: input.extractionRunId,
    extractionWindowCount: 0,
    facts: [],
    factsByType: emptyFactsByType(),
    failedDocumentIds: input.selectedMatterDocumentIds,
    failedRepresentationCount: input.failedRepresentationCount,
    preparedDocumentIds: [],
    profile: input.profile,
    readyRepresentationCount: input.readyRepresentationCount,
    schemaVersion: 1,
    selectedMatterDocumentIds: input.selectedMatterDocumentIds,
    status: "failed",
  };
}

function runningOutput(input: {
  extractionRunId: string;
  profile: "chronology";
  selectedMatterDocumentIds: string[];
}): ExtractionStepOutput {
  return {
    chronologyArtifactId: null,
    collapsedEventCount: 0,
    collapsedEvents: [],
    error: null,
    extractedFactCount: 0,
    extractionRunId: input.extractionRunId,
    extractionWindowCount: 0,
    facts: [],
    factsByType: emptyFactsByType(),
    failedDocumentIds: [],
    failedRepresentationCount: 0,
    preparedDocumentIds: [],
    profile: input.profile,
    readyRepresentationCount: 0,
    schemaVersion: 1,
    selectedMatterDocumentIds: input.selectedMatterDocumentIds,
    status: "running",
  };
}

function prismaStatusFromPluginStatus(status: "COMPLETED" | "FAILED" | "PARTIAL_FAILED") {
  if (status === "COMPLETED") {
    return WorkflowExtractionRunStatus.COMPLETED;
  }

  if (status === "PARTIAL_FAILED") {
    return WorkflowExtractionRunStatus.PARTIAL_FAILED;
  }

  return WorkflowExtractionRunStatus.FAILED;
}

async function assertMatterExists(matterId: string) {
  const matter = await prisma.matter.findUnique({
    select: {
      id: true,
    },
    where: {
      id: matterId,
    },
  });

  if (!matter) {
    throw new Error("Matter was not found.");
  }
}

async function ensureWorkflowRun(input: {
  matterId: string;
  workflowDefinitionId: string;
  workflowRunId: string;
}) {
  return prisma.workflowRun.upsert({
    create: {
      id: input.workflowRunId,
      matterId: input.matterId,
      workflowDefinitionId: input.workflowDefinitionId,
    },
    update: {
      matterId: input.matterId,
      workflowDefinitionId: input.workflowDefinitionId,
    },
    where: {
      id: input.workflowRunId,
    },
  });
}

function testChronologyAIServiceFromEnv(): NonNullable<RunExtractionStepInput["aiService"]> | null {
  const content = process.env.MATTER_LAYER_TEST_CHRONOLOGY_AI_RESPONSE;

  if (!content) {
    return null;
  }

  return {
    generateText: async () => ({
      content,
      model: "test-model",
      provider: "test",
    }),
  };
}

async function extractionAIService(input: RunExtractionStepInput) {
  if (input.aiService) {
    return input.aiService;
  }

  const testAIService = testChronologyAIServiceFromEnv();

  if (testAIService) {
    return testAIService;
  }

  const { createAIService } = await import("@/services/ai/ai-service");

  return createAIService();
}

async function selectedMatterDocumentIdsForInputStep(input: {
  inputStepId: string;
  matterId: string;
  workflowRunId: string;
}) {
  const persistedOutput = await readWorkflowStepOutput({
    stepId: input.inputStepId,
    workflowRunId: input.workflowRunId,
  });
  const outputDocumentIds = selectedIdsFromOutputJson(persistedOutput?.outputJson);

  if (outputDocumentIds.length > 0) {
    return [...new Set(outputDocumentIds)];
  }

  const selectedFiles = await prisma.workflowRunStepFile.findMany({
    select: {
      matterDocumentId: true,
    },
    where: {
      stepId: input.inputStepId,
      workflowRun: {
        id: input.workflowRunId,
        matterId: input.matterId,
      },
    },
  });

  return [...new Set(selectedFiles.map((file) => file.matterDocumentId))];
}

export async function loadExtractionStepState(
  input: RunExtractionStepInput,
): Promise<ExtractionStepState> {
  const config = normalizeExtractionStepConfig(input.step.parameters);

  await assertMatterExists(input.matterId);

  const selectedMatterDocumentIds = await selectedMatterDocumentIdsForInputStep({
    inputStepId: config.inputStepId,
    matterId: input.matterId,
    workflowRunId: input.workflowRunId,
  });
  const [documents, latestOutput, latestRun] = await Promise.all([
    prisma.matterDocument.findMany({
      orderBy: {
        createdAt: "asc",
      },
      select: {
        fileName: true,
        id: true,
        mimeType: true,
        representations: {
          select: {
            error: true,
            status: true,
          },
          where: {
            type: MatterDocumentRepresentationType.MARKDOWN,
          },
        },
      },
      where: {
        id: {
          in: selectedMatterDocumentIds,
        },
        matterId: input.matterId,
      },
    }),
    readWorkflowStepOutput({
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    }),
    prisma.workflowExtractionRun.findFirst({
      orderBy: {
        createdAt: "desc",
      },
      select: {
        status: true,
      },
      where: {
        stepId: input.step.id,
        workflowRunId: input.workflowRunId,
      },
    }),
  ]);

  if (documents.length !== selectedMatterDocumentIds.length) {
    throw new Error("Every selected document must belong to the workflow run matter.");
  }

  return {
    documents: documents.map((document) => {
      const representation = document.representations[0] ?? null;
      const displayState = extractionRepresentationDisplayState(
        representation?.status,
        representation?.error,
      );

      return {
        error: displayState.error,
        fileName: document.fileName,
        id: document.id,
        mimeType: document.mimeType,
        representationStatus: displayState.representationStatus,
      };
    }),
    latestOutput: isObjectRecord(latestOutput?.outputJson)
      ? (latestOutput.outputJson as ExtractionStepOutput)
      : null,
    latestRunStatus: latestRun?.status ?? null,
  };
}

export async function runExtractionStep(
  input: RunExtractionStepInput,
): Promise<ExtractionStepOutput> {
  const config = normalizeExtractionStepConfig(input.step.parameters);
  const profile = getExtractionProfile(config.profile);

  if (config.representationType !== "MARKDOWN") {
    throw new Error(`Unsupported extraction representation type: ${config.representationType}`);
  }

  await ensureWorkflowRun({
    matterId: input.matterId,
    workflowDefinitionId: input.workflowDefinitionId,
    workflowRunId: input.workflowRunId,
  });

  const selectedMatterDocumentIds = await selectedMatterDocumentIdsForInputStep({
    inputStepId: config.inputStepId,
    matterId: input.matterId,
    workflowRunId: input.workflowRunId,
  });

  if (input.executionMode === "autorun") {
    const latestOutput = await readWorkflowStepOutput({
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });

    if (isObjectRecord(latestOutput?.outputJson)) {
      const existingOutput = latestOutput.outputJson as ExtractionStepOutput;

      if (
        existingOutput.status === "completed" ||
        existingOutput.status === "failed" ||
        existingOutput.status === "partial_failed" ||
        existingOutput.status === "running"
      ) {
        return existingOutput;
      }
    }
  }

  if (selectedMatterDocumentIds.length === 0) {
    const extractionRun = await prisma.workflowExtractionRun.create({
      data: {
        error: "No selected matter documents were found for the configured input step.",
        matterId: input.matterId,
        metadataJson: toWorkflowJsonValue({
          profileDescription: profile.description,
          profileLabel: profile.label,
        }),
        profile: config.profile,
        representationType: config.representationType,
        selectedDocumentIdsJson: toWorkflowJsonValue([]),
        startedAt: new Date(),
        status: WorkflowExtractionRunStatus.FAILED,
        stepId: input.step.id,
        workflowRunId: input.workflowRunId,
      },
    });
    const error: WorkflowStepError = {
      code: "DOCUMENT_NOT_FOUND",
      message: "No selected matter documents were found for the configured input step.",
      userMessage:
        "Matter Layer could not find any selected source documents for this preparation step.",
    };
    const output = failedOutput({
      error,
      extractionRunId: extractionRun.id,
      failedRepresentationCount: 0,
      profile: config.profile,
      readyRepresentationCount: 0,
      selectedMatterDocumentIds,
    });

    console.error("Chronology preparation failed", {
      error,
      extractionRunId: extractionRun.id,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });
    await writeWorkflowStepOutput({
      outputJson: output,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });

    return output;
  }

  const selectedDocuments = await prisma.matterDocument.findMany({
    select: {
      fileName: true,
      id: true,
      mimeType: true,
    },
    where: {
      id: {
        in: selectedMatterDocumentIds,
      },
      matterId: input.matterId,
    },
  });

  if (selectedDocuments.length !== selectedMatterDocumentIds.length) {
    const extractionRun = await prisma.workflowExtractionRun.create({
      data: {
        error: "One or more selected documents were not found in the workflow run matter.",
        matterId: input.matterId,
        metadataJson: toWorkflowJsonValue({
          profileDescription: profile.description,
          profileLabel: profile.label,
        }),
        profile: config.profile,
        representationType: config.representationType,
        selectedDocumentIdsJson: toWorkflowJsonValue(selectedMatterDocumentIds),
        startedAt: new Date(),
        status: WorkflowExtractionRunStatus.FAILED,
        stepId: input.step.id,
        workflowRunId: input.workflowRunId,
      },
    });
    const foundDocumentIds = new Set(selectedDocuments.map((document) => document.id));
    const missingDocumentIds = selectedMatterDocumentIds.filter(
      (documentId) => !foundDocumentIds.has(documentId),
    );
    const error: WorkflowStepError = {
      code: "DOCUMENT_ACCESS_DENIED",
      documentErrors: missingDocumentIds.map((matterDocumentId) => ({
        code: "DOCUMENT_ACCESS_DENIED",
        matterDocumentId,
        message:
          "The selected document was not found in the workflow run matter or is not accessible.",
        userMessage: "This document is not available in the current matter.",
      })),
      message: "Every selected document must belong to the workflow run matter.",
      userMessage:
        "Matter Layer could not prepare the selected documents because one or more files are not available in this matter.",
    };
    const output = failedOutput({
      error,
      extractionRunId: extractionRun.id,
      failedRepresentationCount: missingDocumentIds.length,
      profile: config.profile,
      readyRepresentationCount: selectedDocuments.length,
      selectedMatterDocumentIds,
    });

    console.error("Chronology preparation failed", {
      error,
      extractionRunId: extractionRun.id,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });
    await writeWorkflowStepOutput({
      outputJson: output,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });

    return output;
  }
  const selectedDocumentById = new Map<string, SelectedDocument>(
    selectedDocuments.map((document) => [document.id, document]),
  );

  const extractionRun = await prisma.workflowExtractionRun.create({
    data: {
      matterId: input.matterId,
        metadataJson: toWorkflowJsonValue({
          profileDescription: profile.description,
          profileLabel: profile.label,
        }),
      profile: config.profile,
      representationType: config.representationType,
      selectedDocumentIdsJson: toWorkflowJsonValue(selectedMatterDocumentIds),
      startedAt: new Date(),
      status: WorkflowExtractionRunStatus.PROCESSING,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    },
  });
  await writeWorkflowStepOutput({
    outputJson: runningOutput({
      extractionRunId: extractionRun.id,
      profile: config.profile,
      selectedMatterDocumentIds,
    }),
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  const representationResults = [];

  for (const matterDocumentId of selectedMatterDocumentIds) {
    try {
      const representation = await ensureMatterDocumentRepresentation({
        matterDocumentId,
        matterId: input.matterId,
        type: MatterDocumentRepresentationType.MARKDOWN,
      });

      representationResults.push({
        error: representation.error,
        fileName: selectedDocumentById.get(matterDocumentId)?.fileName,
        matterDocumentId,
        mimeType: selectedDocumentById.get(matterDocumentId)?.mimeType,
        status: representation.status,
      });
    } catch (error) {
      console.error("Matter document representation generation failed", {
        error,
        extractionRunId: extractionRun.id,
        matterDocumentId,
        stepId: input.step.id,
        workflowRunId: input.workflowRunId,
      });
      representationResults.push({
        error: "Internal document representation generation error.",
        fileName: selectedDocumentById.get(matterDocumentId)?.fileName,
        matterDocumentId,
        mimeType: selectedDocumentById.get(matterDocumentId)?.mimeType,
        status: MatterDocumentRepresentationStatus.FAILED,
      });
    }
  }

  const readyRepresentationCount = representationResults.filter(
    (result) => result.status === MatterDocumentRepresentationStatus.READY,
  ).length;
  const failedRepresentationCount =
    representationResults.length - readyRepresentationCount;
  const preparedDocumentIds = representationResults
    .filter((result) => result.status === MatterDocumentRepresentationStatus.READY)
    .map((result) => result.matterDocumentId);
  const failedDocumentIds = representationResults
    .filter((result) => result.status !== MatterDocumentRepresentationStatus.READY)
    .map((result) => result.matterDocumentId);
  const documentErrors = representationResults
    .filter((result) => result.status !== MatterDocumentRepresentationStatus.READY)
    .map((result) =>
      documentRepresentationError({
        error: result.error,
        fileName: result.fileName,
        matterDocumentId: result.matterDocumentId,
        mimeType: result.mimeType,
      }),
    );
  const readyDocuments = await prisma.matterDocument.findMany({
    orderBy: {
      createdAt: "asc",
    },
    select: {
      fileName: true,
      id: true,
      representations: {
        select: {
          content: true,
        },
        where: {
          status: MatterDocumentRepresentationStatus.READY,
          type: MatterDocumentRepresentationType.MARKDOWN,
        },
      },
    },
    where: {
      id: {
        in: selectedMatterDocumentIds,
      },
      matterId: input.matterId,
    },
  });
  const chronologyResult =
    readyRepresentationCount > 0
      ? await profile.run({
          aiService: await extractionAIService(input),
          readyDocuments: readyDocuments
            .map((document) => ({
              fileName: document.fileName,
              id: document.id,
              markdown: document.representations[0]?.content ?? "",
            }))
            .filter((document) => document.markdown.trim()),
        })
      : {
          error: "No selected documents could be prepared for extraction.",
          extractedFactCount: 0,
          extractionWindowCount: 0,
          facts: [],
          factsByType: {},
          failedWindowCount: 0,
          model: null,
          provider: null,
          status: "FAILED" as const,
        };
  const chronologyStatus = prismaStatusFromPluginStatus(chronologyResult.status);
  const status =
    failedRepresentationCount > 0 &&
    chronologyStatus === WorkflowExtractionRunStatus.COMPLETED
      ? WorkflowExtractionRunStatus.PARTIAL_FAILED
      : chronologyStatus;
  const firstError =
    representationResults.find((result) => result.error)?.error ??
    chronologyResult.error;
  if (firstError) {
    console.error("Chronology preparation failed", {
      error: firstError,
      extractionRunId: extractionRun.id,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });
  }
  const structuredError =
    extractionStepErrorForDocuments({
      documentErrors,
      partial: readyRepresentationCount > 0 && failedRepresentationCount > 0,
    }) ??
    (chronologyResult.error ? extractionProviderError(chronologyResult.error) : null);
  const chronologyPostprocessResult = buildChronologyPostprocessResult(
    chronologyResult.facts,
  );
  const chronologyArtifact =
    chronologyPostprocessResult.artifactMarkdown &&
    chronologyPostprocessResult.collapsedEventCount > 0
      ? await createWorkflowMarkdownArtifact({
          content: chronologyPostprocessResult.artifactMarkdown,
          matterId: input.matterId,
          metadataJson: {
            collapsedEventCount: chronologyPostprocessResult.collapsedEventCount,
            datedEventCount: chronologyPostprocessResult.datedCollapsedEventCount,
            extractionRunId: extractionRun.id,
            generatedFromFactCount: chronologyPostprocessResult.generatedFromFactCount,
            profile: "chronology",
            sourceDocumentCount: selectedMatterDocumentIds.length,
            undatedEventCount: chronologyPostprocessResult.undatedCollapsedEventCount,
          },
          stepId: input.step.id,
          title: "Chronology Draft",
          workflowRunId: input.workflowRunId,
        })
      : null;
  const output: ExtractionStepOutput = {
    chronologyArtifactId: chronologyArtifact?.id ?? null,
    collapsedEventCount: chronologyPostprocessResult.collapsedEventCount,
    collapsedEvents: chronologyPostprocessResult.events,
    error: structuredError,
    extractedFactCount: chronologyResult.extractedFactCount,
    extractionWindowCount: chronologyResult.extractionWindowCount,
    extractionRunId: extractionRun.id,
    facts: chronologyPostprocessResult.facts,
    factsByType: chronologyResult.factsByType,
    failedDocumentIds,
    failedRepresentationCount,
    preparedDocumentIds,
    profile: config.profile,
    readyRepresentationCount,
    schemaVersion: 1,
    selectedMatterDocumentIds,
    status: outputStatusFromRunStatus(status),
  };

  await prisma.workflowExtractionRun.update({
    data: {
      completedAt: new Date(),
      error: firstError,
      metadataJson: toWorkflowJsonValue({
        aiModel: chronologyResult.model,
        aiProvider: chronologyResult.provider,
        chronologyArtifactId: chronologyArtifact?.id ?? null,
        collapsedEventCount: chronologyPostprocessResult.collapsedEventCount,
        datedCollapsedEventCount:
          chronologyPostprocessResult.datedCollapsedEventCount,
        documentRepresentations: representationResults,
        extractedFactCount: chronologyResult.extractedFactCount,
        extractionWindowCount: chronologyResult.extractionWindowCount,
        failedRepresentationCount,
        failedWindowCount: chronologyResult.failedWindowCount,
        factsByType: chronologyResult.factsByType,
        profileDescription: profile.description,
        profileLabel: profile.label,
        readyRepresentationCount,
        selectedDocumentCount: selectedMatterDocumentIds.length,
        undatedCollapsedEventCount:
          chronologyPostprocessResult.undatedCollapsedEventCount,
      }),
      status,
    },
    where: {
      id: extractionRun.id,
    },
  });
  await writeWorkflowStepOutput({
    outputJson: output,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  return output;
}
