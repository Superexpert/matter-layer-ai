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
import { getExtractionProfile } from "./profiles";
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

function displayRepresentationStatus(
  status: MatterDocumentRepresentationStatus | null | undefined,
) {
  if (status === MatterDocumentRepresentationStatus.READY) {
    return "Ready" as const;
  }

  if (status === MatterDocumentRepresentationStatus.PROCESSING) {
    return "Processing" as const;
  }

  if (status === MatterDocumentRepresentationStatus.FAILED) {
    return "Failed" as const;
  }

  return "Not started" as const;
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

      return {
        error: representation?.error ?? null,
        fileName: document.fileName,
        id: document.id,
        mimeType: document.mimeType,
        representationStatus: displayRepresentationStatus(representation?.status),
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
  const status =
    readyRepresentationCount === representationResults.length
      ? WorkflowExtractionRunStatus.COMPLETED
      : readyRepresentationCount === 0
        ? WorkflowExtractionRunStatus.FAILED
        : WorkflowExtractionRunStatus.PARTIAL_FAILED;
  const firstError = representationResults.find((result) => result.error)?.error ?? null;
  const output: ExtractionStepOutput = {
    extractionRunId: extractionRun.id,
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
          documentRepresentations: representationResults,
          profileDescription: profile.description,
          profileLabel: profile.label,
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
