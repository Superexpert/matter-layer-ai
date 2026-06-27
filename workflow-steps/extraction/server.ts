import "server-only";

import {
  MatterDocumentRepresentationStatus,
  MatterDocumentRepresentationType,
  Prisma,
  WorkflowExtractionRunStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { ensureMatterDocumentRepresentation } from "@/services/matter-documents/representations";
import type { WorkflowStepDefinition } from "@/services/workflows/types";
import { extractionRepresentationDisplayState } from "./display-state";
import { getExtractionProfile } from "./profiles";
import { generateChronologyArtifactForRun } from "./profiles/chronology/postprocess";
import {
  normalizeExtractionStepConfig,
  type ExtractionStepOutput,
} from "./schema";

export type ExtractionDocumentState = {
  error: string | null;
  fileName: string;
  id: string;
  mimeType: string;
  representationStatus: "Failed" | "Not started" | "Processing" | "Ready";
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
  matterId: string;
  step: WorkflowStepDefinition;
  workflowDefinitionId: string;
  workflowRunId: string;
};

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

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
  const persistedOutput = await prisma.workflowRunStepOutput.findUnique({
    select: {
      outputJson: true,
    },
    where: {
      workflowRunId_stepId: {
        stepId: input.inputStepId,
        workflowRunId: input.workflowRunId,
      },
    },
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
    prisma.workflowRunStepOutput.findUnique({
      select: {
        outputJson: true,
      },
      where: {
        workflowRunId_stepId: {
          stepId: input.step.id,
          workflowRunId: input.workflowRunId,
        },
      },
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

  if (selectedMatterDocumentIds.length === 0) {
    throw new Error("Select source documents before preparing extraction.");
  }

  const selectedDocuments = await prisma.matterDocument.findMany({
    select: {
      id: true,
    },
    where: {
      id: {
        in: selectedMatterDocumentIds,
      },
      matterId: input.matterId,
    },
  });

  if (selectedDocuments.length !== selectedMatterDocumentIds.length) {
    throw new Error("Every selected document must belong to the workflow run matter.");
  }

  const extractionRun = await prisma.workflowExtractionRun.create({
    data: {
      matterId: input.matterId,
      metadataJson: jsonValue({
        profileDescription: profile.description,
        profileLabel: profile.label,
      }),
      profile: config.profile,
      representationType: config.representationType,
      selectedDocumentIdsJson: jsonValue(selectedMatterDocumentIds),
      startedAt: new Date(),
      status: WorkflowExtractionRunStatus.PROCESSING,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    },
  });

  const representationResults = [];

  for (const matterDocumentId of selectedMatterDocumentIds) {
    const representation = await ensureMatterDocumentRepresentation({
      matterDocumentId,
      matterId: input.matterId,
      type: MatterDocumentRepresentationType.MARKDOWN,
    });

    representationResults.push({
      error: representation.error,
      matterDocumentId,
      status: representation.status,
    });
  }

  const readyRepresentationCount = representationResults.filter(
    (result) => result.status === MatterDocumentRepresentationStatus.READY,
  ).length;
  const failedRepresentationCount =
    representationResults.length - readyRepresentationCount;
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
          extractionRunId: extractionRun.id,
          matterId: input.matterId,
          prisma,
          readyDocuments: readyDocuments
            .map((document) => ({
              fileName: document.fileName,
              id: document.id,
              markdown: document.representations[0]?.content ?? "",
            }))
            .filter((document) => document.markdown.trim()),
          stepId: input.step.id,
          workflowRunId: input.workflowRunId,
        })
      : {
          error: "No selected documents could be prepared for extraction.",
          extractedFactCount: 0,
          extractionWindowCount: 0,
          factsByType: {},
          failedWindowCount: 0,
          model: null,
          provider: null,
          status: WorkflowExtractionRunStatus.FAILED,
        };
  const status =
    failedRepresentationCount > 0 &&
    chronologyResult.status === WorkflowExtractionRunStatus.COMPLETED
      ? WorkflowExtractionRunStatus.PARTIAL_FAILED
      : chronologyResult.status;
  const firstError =
    representationResults.find((result) => result.error)?.error ??
    chronologyResult.error;
  const chronologyPostprocessResult =
    config.profile === "chronology" && chronologyResult.extractedFactCount > 0
      ? await generateChronologyArtifactForRun({
          extractionRunId: extractionRun.id,
          matterId: input.matterId,
          prisma,
          selectedDocumentCount: selectedMatterDocumentIds.length,
          stepId: input.step.id,
          workflowRunId: input.workflowRunId,
        })
      : {
          chronologyArtifactId: null,
          collapsedEventCount: 0,
          datedCollapsedEventCount: 0,
          undatedCollapsedEventCount: 0,
        };
  const output: ExtractionStepOutput = {
    chronologyArtifactId: chronologyPostprocessResult.chronologyArtifactId,
    collapsedEventCount: chronologyPostprocessResult.collapsedEventCount,
    extractedFactCount: chronologyResult.extractedFactCount,
    extractionWindowCount: chronologyResult.extractionWindowCount,
    extractionRunId: extractionRun.id,
    factsByType: chronologyResult.factsByType,
    failedRepresentationCount,
    profile: config.profile,
    readyRepresentationCount,
    selectedMatterDocumentIds,
    status: outputStatusFromRunStatus(status),
  };

  await prisma.$transaction([
    prisma.workflowExtractionRun.update({
      data: {
        completedAt: new Date(),
        error: firstError,
        metadataJson: jsonValue({
          aiModel: chronologyResult.model,
          aiProvider: chronologyResult.provider,
          chronologyArtifactId: chronologyPostprocessResult.chronologyArtifactId,
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
    }),
    prisma.workflowRunStepOutput.upsert({
      create: {
        outputJson: jsonValue(output),
        stepId: input.step.id,
        workflowRunId: input.workflowRunId,
      },
      update: {
        outputJson: jsonValue(output),
      },
      where: {
        workflowRunId_stepId: {
          stepId: input.step.id,
          workflowRunId: input.workflowRunId,
        },
      },
    }),
  ]);

  return output;
}
