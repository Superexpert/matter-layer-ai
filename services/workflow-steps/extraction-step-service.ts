import "server-only";

import {
  MatterDocumentRepresentationStatus,
  MatterDocumentRepresentationType,
  Prisma,
  WorkflowExtractionRunStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  classifyAIProviderError,
  isAIProviderError,
} from "@/services/ai/provider-errors";
import { ensureMatterDocumentRepresentation } from "@/services/matter-documents/representations";
import {
  clearWorkflowStepActivityEvents,
  emitWorkflowActivityEvent,
  listWorkflowStepActivityEvents,
  type EmitWorkflowActivityInput,
  type WorkflowActivityEvent,
} from "@/services/workflows/workflow-activity-service";
import { createWorkflowMarkdownArtifact } from "@/services/workflows/workflow-artifact-service";
import {
  readWorkflowStepOutput,
  toWorkflowJsonValue,
  writeWorkflowStepOutput,
} from "@/services/workflows/workflow-step-output-service";
import {
  activeProgressItem,
  completedProgressItemCount,
  progressPercentFromItems,
  type WorkflowStepProgress,
  type WorkflowStepProgressItem,
} from "@/services/workflows/workflow-step-progress";
import type { WorkflowStepDefinition } from "@/services/workflows/types";
import { extractionRepresentationDisplayState } from "@/workflow-steps/extraction/display-state";
import { getExtractionProfile } from "@/workflow-steps/extraction/profiles";
import type { ChronologyFact } from "@/workflow-steps/extraction/profiles/chronology/schema";
import { buildChronologyPostprocessResult } from "@/workflow-steps/extraction/profiles/chronology/postprocess";
import {
  normalizeExtractionStepConfig,
  type ExtractionStepOutput,
} from "@/workflow-steps/extraction/schema";
import {
  documentRepresentationError,
  extractionProviderError,
  extractionStepErrorForDocuments,
  safeUnknownExtractionError,
} from "@/workflow-steps/extraction/errors";
import type {
  WorkflowStepDocumentError,
  WorkflowStepError,
} from "@/services/workflows/workflow-step-errors";

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

type RepresentationResult = {
  error: string | null;
  fileName: string;
  matterDocumentId: string;
  mimeType: string;
  status: MatterDocumentRepresentationStatus;
};

type ChronologyResultAggregate = {
  error: string | null;
  errorCode: string | null;
  errorProvider: string | null;
  errorStatus: number | null;
  errorUserMessage: string | null;
  extractedFactCount: number;
  extractionWindowCount: number;
  facts: ChronologyFact[];
  factsByType: Record<string, number>;
  failedWindowCount: number;
  model: string | null;
  provider: string | null;
  status: "COMPLETED" | "FAILED" | "PARTIAL_FAILED";
};

type ExtractionExecutionOptions = {
  ignoreExistingRunning?: boolean;
};

type DocumentChronologyExtractionOutcome = {
  chronologyResult: ChronologyResultAggregate;
  documentError: WorkflowStepDocumentError | null;
  matterDocumentId: string;
};

export type ExtractionStepState = {
  activityEvents: WorkflowActivityEvent[];
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
  onProgress?: (output: ExtractionStepOutput) => Promise<void> | void;
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

function progressItemsForDocuments(
  selectedDocuments: SelectedDocument[],
): WorkflowStepProgressItem[] {
  return selectedDocuments.map((document) => ({
    id: document.id,
    label: document.fileName,
    message: "Queued",
    phase: "queued",
    percentComplete: 0,
    status: "waiting",
  }));
}

function buildProgress(input: {
  currentItemLabel?: string;
  items: WorkflowStepProgressItem[];
  message: string;
  status: WorkflowStepProgress["status"];
}): WorkflowStepProgress {
  const totalItems = input.items.length;
  const activeItem = activeProgressItem(input.items);

  return {
    activeItemId: activeItem?.id,
    activeItemLabel: activeItem?.label ?? input.currentItemLabel,
    activePhase: activeItem?.phase,
    completedItems: completedProgressItemCount(input.items),
    currentItemId: activeItem?.id,
    currentItemLabel: activeItem?.label ?? input.currentItemLabel,
    currentItemMessage: activeItem?.message,
    currentItemPhase: activeItem?.phase,
    items: input.items,
    message: input.message,
    percentComplete: progressPercentFromItems(input.items),
    status: input.status,
    totalItems,
  };
}

function updateProgressItem(
  items: WorkflowStepProgressItem[],
  id: string,
  patch: Partial<WorkflowStepProgressItem>,
) {
  return items.map((item) =>
    item.id === id
      ? {
          ...item,
          ...patch,
        }
      : item,
  );
}

function workflowProgressDebugDelayMs() {
  const rawValue = process.env.WORKFLOW_PROGRESS_DEBUG_DELAY_MS;

  if (!rawValue) {
    return 0;
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return 0;
  }

  return parsedValue;
}

async function waitForWorkflowProgressDebugDelay() {
  const delayMs = workflowProgressDebugDelayMs();

  if (delayMs <= 0) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function workflowActivityDebugDelayMs() {
  const rawValue = process.env.WORKFLOW_ACTIVITY_DEBUG_DELAY_MS;

  if (!rawValue) {
    return 0;
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return 0;
  }

  return parsedValue;
}

async function waitForWorkflowActivityDebugDelay() {
  const delayMs = workflowActivityDebugDelayMs();

  if (delayMs <= 0) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function debugWorkflowProgress(input: {
  output: ExtractionStepOutput;
  stepId: string;
  workflowRunId: string;
}) {
  if (process.env.WORKFLOW_PROGRESS_DEBUG !== "1") {
    return;
  }

  console.info("Workflow progress update", {
    activeItemId: input.output.progress?.currentItemId,
    activePhase: input.output.progress?.currentItemPhase,
    percentComplete: input.output.progress?.percentComplete,
    status: input.output.status,
    stepId: input.stepId,
    workflowRunId: input.workflowRunId,
  });
}

function workflowDebugLog(message: string, metadata: Record<string, unknown> = {}) {
  if (process.env.WORKFLOW_DEBUG !== "true" && process.env.WORKFLOW_DEBUG !== "1") {
    return;
  }

  console.info(`[workflow:autorun] ${message}`, metadata);
}

function chronologyServiceLog(message: string, metadata: Record<string, unknown> = {}) {
  console.info(`[chronology:service] ${message}`, metadata);
}

function chronologyDocumentConcurrency() {
  const rawValue = process.env.MATTER_LAYER_CHRONOLOGY_DOCUMENT_CONCURRENCY;

  if (!rawValue) {
    return 3;
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    throw new Error(
      "MATTER_LAYER_CHRONOLOGY_DOCUMENT_CONCURRENCY must be a positive integer.",
    );
  }

  return parsedValue;
}

async function runBoundedParallel<T, R>(input: {
  concurrency: number;
  items: T[];
  worker: (item: T, index: number) => Promise<R>;
}) {
  if (input.concurrency < 1) {
    throw new Error("Parallel worker concurrency must be at least 1.");
  }

  const results = new Array<R>(input.items.length);
  let nextIndex = 0;
  const workerCount = Math.min(input.concurrency, input.items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const itemIndex = nextIndex;
        nextIndex += 1;

        if (itemIndex >= input.items.length) {
          return;
        }

        results[itemIndex] = await input.worker(input.items[itemIndex]!, itemIndex);
      }
    }),
  );

  return results;
}

function conciseUnhandledExtractionError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 1000);
  }

  return "Unexpected extraction preparation error.";
}

function pageRangeLabel(input: { pageEnd: number | null; pageStart: number | null }) {
  if (input.pageStart === null || input.pageEnd === null) {
    return null;
  }

  return input.pageStart === input.pageEnd
    ? `page ${input.pageStart}`
    : `pages ${input.pageStart}-${input.pageEnd}`;
}

function extractionWindowMessage(input: {
  pageEnd: number | null;
  pageStart: number | null;
  windowCount: number;
  windowIndex: number;
}) {
  const rangeLabel = pageRangeLabel(input);
  const windowLabel = `Window ${input.windowIndex} of ${input.windowCount}`;

  return rangeLabel ? `${windowLabel}, ${rangeLabel}` : windowLabel;
}

function elapsedSeconds(ms: number) {
  return Math.max(0, Math.round(ms / 1000));
}

function extractionWindowPercent(input: {
  windowCount: number;
  windowIndex: number;
}) {
  if (input.windowCount <= 0) {
    return 75;
  }

  const completedBeforeCurrentWindow = Math.max(0, input.windowIndex - 1);
  const windowFraction = completedBeforeCurrentWindow / input.windowCount;

  return Math.min(95, Math.max(75, Math.round(75 + windowFraction * 20)));
}

function autorunJobKey(input: RunExtractionStepInput) {
  return `${input.workflowRunId}:${input.step.id}`;
}

const backgroundExtractionJobs = new Map<string, Promise<ExtractionStepOutput>>();

function autorunStartingOutput(input: {
  profile: "chronology";
  workflowRunId: string;
}): ExtractionStepOutput {
  return {
    chronologyArtifactId: null,
    collapsedEventCount: 0,
    collapsedEvents: [],
    error: null,
    extractedFactCount: 0,
    extractionRunId: `autorun-starting-${input.workflowRunId}`,
    extractionWindowCount: 0,
    facts: [],
    factsByType: emptyFactsByType(),
    failedDocumentIds: [],
    failedRepresentationCount: 0,
    preparedDocumentIds: [],
    profile: input.profile,
    progress: {
      completedItems: 0,
      items: [],
      message: "Starting chronology preparation...",
      percentComplete: 0,
      status: "running",
      totalItems: 0,
    },
    readyRepresentationCount: 0,
    schemaVersion: 1,
    selectedMatterDocumentIds: [],
    status: "running",
  };
}

function failedOutput(input: {
  error: WorkflowStepError;
  extractionRunId: string;
  failedRepresentationCount: number;
  progress?: WorkflowStepProgress | null;
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
    progress: input.progress ?? null,
    readyRepresentationCount: input.readyRepresentationCount,
    schemaVersion: 1,
    selectedMatterDocumentIds: input.selectedMatterDocumentIds,
    status: "failed",
  };
}

function runningOutput(input: {
  extractionRunId: string;
  progress: WorkflowStepProgress;
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
    progress: input.progress,
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

function emptyChronologyResultAggregate(): ChronologyResultAggregate {
  return {
    error: null,
    errorCode: null,
    errorProvider: null,
    errorStatus: null,
    errorUserMessage: null,
    extractedFactCount: 0,
    extractionWindowCount: 0,
    facts: [],
    factsByType: emptyFactsByType(),
    failedWindowCount: 0,
    model: null,
    provider: null,
    status: "COMPLETED",
  };
}

function mergeChronologyResult(
  aggregate: ChronologyResultAggregate,
  nextResult: ChronologyResultAggregate,
): ChronologyResultAggregate {
  const factsByType = {
    ...aggregate.factsByType,
  };

  for (const [factType, count] of Object.entries(nextResult.factsByType)) {
    factsByType[factType] = (factsByType[factType] ?? 0) + count;
  }

  const failedWindowCount = aggregate.failedWindowCount + nextResult.failedWindowCount;
  const extractionWindowCount =
    aggregate.extractionWindowCount + nextResult.extractionWindowCount;
  const extractedFactCount =
    aggregate.extractedFactCount + nextResult.extractedFactCount;
  let status: ChronologyResultAggregate["status"] = "COMPLETED";

  if (extractionWindowCount === 0 || failedWindowCount === extractionWindowCount) {
    status = "FAILED";
  } else if (failedWindowCount > 0) {
    status = "PARTIAL_FAILED";
  }

  return {
    error: aggregate.error ?? nextResult.error,
    errorCode: aggregate.errorCode ?? nextResult.errorCode,
    errorProvider: aggregate.errorProvider ?? nextResult.errorProvider,
    errorStatus: aggregate.errorStatus ?? nextResult.errorStatus,
    errorUserMessage: aggregate.errorUserMessage ?? nextResult.errorUserMessage,
    extractedFactCount,
    extractionWindowCount,
    facts: [...aggregate.facts, ...nextResult.facts],
    factsByType,
    failedWindowCount,
    model: aggregate.model ?? nextResult.model,
    provider: aggregate.provider ?? nextResult.provider,
    status,
  };
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

  try {
    return await createAIService();
  } catch (error) {
    throw classifyAIProviderError(error);
  }
}

function persistedExtractionRunId(value: string | null | undefined) {
  if (!value || value.startsWith("local-running-") || value.startsWith("autorun-starting-")) {
    return null;
  }

  return value;
}

async function recoverUnhandledExtractionFailure(input: {
  error: unknown;
  matterId: string;
  step: WorkflowStepDefinition;
  workflowDefinitionId: string;
  workflowRunId: string;
}): Promise<ExtractionStepOutput> {
  const config = normalizeExtractionStepConfig(input.step.parameters);
  const error: WorkflowStepError = isAIProviderError(input.error)
    ? {
        code: input.error.code,
        message: input.error.message,
        userMessage: input.error.userMessage,
      }
    : safeUnknownExtractionError(input.error);
  const errorMessage = conciseUnhandledExtractionError(input.error);
  const latestOutputRow = await readWorkflowStepOutput({
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });
  const latestOutput = isObjectRecord(latestOutputRow?.outputJson)
    ? (latestOutputRow.outputJson as ExtractionStepOutput)
    : null;

  if (
    latestOutput?.status === "completed" ||
    latestOutput?.status === "failed" ||
    latestOutput?.status === "partial_failed"
  ) {
    return latestOutput;
  }

  await ensureWorkflowRun({
    matterId: input.matterId,
    workflowDefinitionId: input.workflowDefinitionId,
    workflowRunId: input.workflowRunId,
  });

  const selectedMatterDocumentIds = latestOutput?.selectedMatterDocumentIds.length
    ? latestOutput.selectedMatterDocumentIds
    : await selectedMatterDocumentIdsForInputStep({
        inputStepId: config.inputStepId,
        matterId: input.matterId,
        workflowRunId: input.workflowRunId,
      });
  const existingRunId = persistedExtractionRunId(latestOutput?.extractionRunId);
  const latestProcessingRun = existingRunId
    ? null
    : await prisma.workflowExtractionRun.findFirst({
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
        },
        where: {
          status: WorkflowExtractionRunStatus.PROCESSING,
          stepId: input.step.id,
          workflowRunId: input.workflowRunId,
        },
      });
  const extractionRunId = existingRunId ?? latestProcessingRun?.id ??
    (await prisma.workflowExtractionRun.create({
      data: {
        completedAt: new Date(),
        error: errorMessage,
        matterId: input.matterId,
        metadataJson: toWorkflowJsonValue({
          recovery: "unhandled_exception",
        }),
        profile: config.profile,
        representationType: config.representationType,
        selectedDocumentIdsJson: toWorkflowJsonValue(selectedMatterDocumentIds),
        startedAt: new Date(),
        status: WorkflowExtractionRunStatus.FAILED,
        stepId: input.step.id,
        workflowRunId: input.workflowRunId,
      },
      select: {
        id: true,
      },
    })).id;

  await prisma.workflowExtractionRun.updateMany({
    data: {
      completedAt: new Date(),
      error: errorMessage,
      status: WorkflowExtractionRunStatus.FAILED,
    },
    where: {
      id: extractionRunId,
    },
  });

  const latestProgressItems = latestOutput?.progress?.items ?? [];
  const activeItemId = latestOutput?.progress?.currentItemId ??
    latestProgressItems.find((item) => item.status === "running")?.id;
  const progressItems = latestProgressItems.map((item) =>
    item.id === activeItemId || item.status === "running"
      ? {
          ...item,
          error: {
            code: error.code,
            userMessage: error.userMessage,
          },
          message: "Failed",
          phase: "failed" as const,
          percentComplete: 100,
          status: "failed" as const,
        }
      : item,
  );
  const output = failedOutput({
    error,
    extractionRunId,
    failedRepresentationCount: selectedMatterDocumentIds.length,
    progress: buildProgress({
      items: progressItems,
      message: "Preparation failed.",
      status: "failed",
    }),
    profile: config.profile,
    readyRepresentationCount: latestOutput?.readyRepresentationCount ?? 0,
    selectedMatterDocumentIds,
  });

  await writeWorkflowStepOutput({
    outputJson: output,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });
  chronologyServiceLog("recovery output write completed", {
    errorCode: error.code,
    extractionRunId,
    outputStatus: output.status,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });
  await emitWorkflowActivityEvent({
    code: "chronology.prepare.failed",
    level: "error",
    message: `Preparation failed: ${errorMessage}`,
    metadata: {
      error: errorMessage,
      recovery: "unhandled_exception",
    },
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  return output;
}

async function executeExtractionStepWithRecovery(
  input: RunExtractionStepInput,
  options: ExtractionExecutionOptions = {},
): Promise<ExtractionStepOutput> {
  try {
    return await executeExtractionStep(input, options);
  } catch (error) {
    console.error("[workflow:extraction] Unhandled extraction failure", {
      error,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });

    return recoverUnhandledExtractionFailure({
      error,
      matterId: input.matterId,
      step: input.step,
      workflowDefinitionId: input.workflowDefinitionId,
      workflowRunId: input.workflowRunId,
    });
  }
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
  const [documents, latestOutput, latestRun, activityEvents] = await Promise.all([
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
    listWorkflowStepActivityEvents({
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    }),
  ]);

  if (documents.length !== selectedMatterDocumentIds.length) {
    throw new Error("Every selected document must belong to the workflow run matter.");
  }

  return {
    activityEvents,
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
  const isAutorun = input.executionMode === "autorun";

  if (!isAutorun) {
    workflowDebugLog("Manual step execution started", {
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });

    return executeExtractionStepWithRecovery(input);
  }

  workflowDebugLog("Checking active step", {
    autorun: Boolean(input.step.autorun),
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  const latestOutput = await readWorkflowStepOutput({
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  if (isObjectRecord(latestOutput?.outputJson)) {
    const existingOutput = latestOutput.outputJson as ExtractionStepOutput;

    workflowDebugLog("Existing step status found", {
      decision: existingOutput.status === "running"
        ? "already_running"
        : existingOutput.status === "completed"
          ? "already_completed"
          : existingOutput.status,
      status: existingOutput.status,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });

    if (
      existingOutput.status === "running" ||
      existingOutput.status === "completed" ||
      existingOutput.status === "failed" ||
      existingOutput.status === "partial_failed"
    ) {
      return existingOutput;
    }
  }

  const key = autorunJobKey(input);

  if (!backgroundExtractionJobs.has(key)) {
    workflowDebugLog("Starting step", {
      decision: "start",
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });

    const job = executeExtractionStepWithRecovery(
      {
        ...input,
        executionMode: "autorun",
      },
      {
        ignoreExistingRunning: true,
      },
    );

    void job
      .then((output) => {
        workflowDebugLog("Step execution completed", {
          status: output.status,
          stepId: input.step.id,
          workflowRunId: input.workflowRunId,
        });

        return output;
      })
      .catch((error) => {
        console.error("[workflow:autorun] Step execution failed", {
          error,
          stepId: input.step.id,
          workflowRunId: input.workflowRunId,
        });
      })
      .finally(() => {
        backgroundExtractionJobs.delete(key);
      });

    backgroundExtractionJobs.set(key, job);
  } else {
    workflowDebugLog("Skipping step start because a background job is already running", {
      decision: "already_running",
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });
  }

  return autorunStartingOutput({
    profile: profile.id,
    workflowRunId: input.workflowRunId,
  });
}

async function executeExtractionStep(
  input: RunExtractionStepInput,
  options: ExtractionExecutionOptions = {},
): Promise<ExtractionStepOutput> {
  const config = normalizeExtractionStepConfig(input.step.parameters);
  const profile = getExtractionProfile(config.profile);

  workflowDebugLog("Step execution started", {
    executionMode: input.executionMode ?? "manual",
    ignoreExistingRunning: options.ignoreExistingRunning === true,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

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

  const latestOutput = await readWorkflowStepOutput({
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  if (isObjectRecord(latestOutput?.outputJson)) {
    const existingOutput = latestOutput.outputJson as ExtractionStepOutput;

    if (existingOutput.status === "running" && !options.ignoreExistingRunning) {
      return existingOutput;
    }

    if (
      input.executionMode === "autorun" &&
      (existingOutput.status === "completed" ||
        existingOutput.status === "failed" ||
        existingOutput.status === "partial_failed")
    ) {
      return existingOutput;
    }
  }

  await clearWorkflowStepActivityEvents({
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  async function emitActivity(
    activity: Omit<EmitWorkflowActivityInput, "stepId" | "workflowRunId">,
  ) {
    const event = await emitWorkflowActivityEvent({
      ...activity,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });

    if (process.env.WORKFLOW_ACTIVITY_DEBUG === "1") {
      console.info("Workflow activity event", {
        code: event.code,
        documentId: event.documentId,
        level: event.level,
        message: event.message,
        stepId: event.stepId,
        workflowRunId: event.workflowRunId,
      });
    }

    await waitForWorkflowActivityDebugDelay();

    return event;
  }

  await emitActivity({
    code: "chronology.prepare.started",
    level: "info",
    message: "Started chronology preparation.",
    metadata: {
      profile: config.profile,
      representationType: config.representationType,
    },
  });

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
      progress: buildProgress({
        items: [],
        message: "Preparation failed.",
        status: "failed",
      }),
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
    await emitActivity({
      code: "chronology.prepare.failed",
      level: "error",
      message: "Preparation failed. No selected source documents were found.",
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
    await emitActivity({
      code: "chronology.prepare.selected_documents_loaded",
      level: "warning",
      message: `Loaded ${selectedDocuments.length} of ${selectedMatterDocumentIds.length} selected documents.`,
      metadata: {
        foundDocumentCount: selectedDocuments.length,
        selectedDocumentCount: selectedMatterDocumentIds.length,
      },
    });
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
      progress: buildProgress({
        items: selectedMatterDocumentIds.map((matterDocumentId) => ({
          error: {
            code: foundDocumentIds.has(matterDocumentId)
              ? "DOCUMENT_PREPARATION_FAILED"
              : "DOCUMENT_ACCESS_DENIED",
            userMessage: foundDocumentIds.has(matterDocumentId)
              ? "This document could not be prepared."
              : "This document is not available in the current matter.",
          },
          id: matterDocumentId,
          label: selectedDocuments.find((document) => document.id === matterDocumentId)?.fileName ??
            matterDocumentId,
          message: foundDocumentIds.has(matterDocumentId)
            ? "Skipped"
            : "Failed",
          phase: foundDocumentIds.has(matterDocumentId)
            ? "queued"
            : "failed",
          percentComplete: 100,
          status: foundDocumentIds.has(matterDocumentId)
            ? "skipped"
            : "failed",
        })),
        message: "Preparation failed.",
        status: "failed",
      }),
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
    await emitActivity({
      code: "chronology.prepare.failed",
      level: "error",
      message: "Preparation failed. One or more selected documents were not available in this matter.",
      metadata: {
        missingDocumentCount: missingDocumentIds.length,
      },
    });

    return output;
  }
  await emitActivity({
    code: "chronology.prepare.selected_documents_loaded",
    level: "info",
    message: `Loaded ${selectedDocuments.length} selected document${selectedDocuments.length === 1 ? "" : "s"}.`,
    metadata: {
      selectedDocumentCount: selectedDocuments.length,
    },
  });
  const selectedDocumentById = new Map<string, SelectedDocument>(
    selectedDocuments.map((document) => [document.id, document]),
  );
  const orderedSelectedDocuments = selectedMatterDocumentIds.map((documentId) => {
    const selectedDocument = selectedDocumentById.get(documentId);

    if (!selectedDocument) {
      throw new Error(`Selected document was not loaded: ${documentId}`);
    }

    return selectedDocument;
  });
  let progressItems = progressItemsForDocuments(orderedSelectedDocuments);

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
  async function persistRunningProgress(progressInput: {
    currentItemLabel?: string;
    message: string;
  }) {
    const output = runningOutput({
      extractionRunId: extractionRun.id,
      progress: buildProgress({
        currentItemLabel: progressInput.currentItemLabel,
        items: progressItems,
        message: progressInput.message,
        status: "running",
      }),
      profile: config.profile,
      selectedMatterDocumentIds,
    });

    await writeWorkflowStepOutput({
      outputJson: output,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });
    debugWorkflowProgress({
      output,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });
    await input.onProgress?.(output);
    await waitForWorkflowProgressDebugDelay();
  }

  await persistRunningProgress({
    message: "Preparing selected documents...",
  });

  const representationResults: RepresentationResult[] = [];

  for (const matterDocumentId of selectedMatterDocumentIds) {
    const selectedDocument = selectedDocumentById.get(matterDocumentId);
    const documentName = selectedDocument?.fileName ?? matterDocumentId;

    await emitActivity({
      code: "chronology.prepare.document_started",
      documentId: matterDocumentId,
      documentName,
      level: "info",
      message: `Checking ${documentName}.`,
    });

    await emitActivity({
      code: "chronology.prepare.representation_lookup_started",
      documentId: matterDocumentId,
      documentName,
      level: "debug",
      message: `Looking for an existing Markdown representation for ${documentName}.`,
    });
    const existingRepresentation = await prisma.matterDocumentRepresentation.findUnique({
      select: {
        status: true,
      },
      where: {
        matterDocumentId_type: {
          matterDocumentId,
          type: MatterDocumentRepresentationType.MARKDOWN,
        },
      },
    });

    if (existingRepresentation?.status === MatterDocumentRepresentationStatus.READY) {
      await emitActivity({
        code: "chronology.prepare.representation_found",
        documentId: matterDocumentId,
        documentName,
        level: "info",
        message: `Found existing Markdown representation for ${documentName}.`,
      });
    } else {
      await emitActivity({
        code: "chronology.prepare.representation_missing",
        documentId: matterDocumentId,
        documentName,
        level: "info",
        message: `No ready Markdown representation was found for ${documentName}.`,
      });
    }

    progressItems = updateProgressItem(progressItems, matterDocumentId, {
      message: "Loading document...",
      phase: "loading",
      percentComplete: 15,
      status: "running",
    });
    await persistRunningProgress({
      currentItemLabel: selectedDocument?.fileName,
      message: "Preparing selected documents...",
    });

    await emitActivity({
      code: "chronology.prepare.document_content_lookup_started",
      documentId: matterDocumentId,
      documentName,
      level: "debug",
      message: `Loading source content for ${documentName}.`,
    });

    progressItems = updateProgressItem(progressItems, matterDocumentId, {
      message: "Converting to AI-readable Markdown...",
      phase: "converting",
      percentComplete: 40,
      status: "running",
    });
    await persistRunningProgress({
      currentItemLabel: selectedDocument?.fileName,
      message: "Preparing selected documents...",
    });
    if (existingRepresentation?.status !== MatterDocumentRepresentationStatus.READY) {
      await emitActivity({
        code: "chronology.prepare.markdown_conversion_started",
        documentId: matterDocumentId,
        documentName,
        level: "info",
        message: `Creating AI-readable Markdown for ${documentName}.`,
      });
    }

    try {
      const representation = await ensureMatterDocumentRepresentation({
        matterDocumentId,
        matterId: input.matterId,
        type: MatterDocumentRepresentationType.MARKDOWN,
      });

      representationResults.push({
        error: representation.error,
        fileName: selectedDocument?.fileName ?? matterDocumentId,
        matterDocumentId,
        mimeType: selectedDocument?.mimeType ?? "",
        status: representation.status,
      });

      if (representation.status === MatterDocumentRepresentationStatus.READY) {
        await emitActivity({
          code: existingRepresentation?.status === MatterDocumentRepresentationStatus.READY
            ? "chronology.prepare.document_content_found"
            : "chronology.prepare.markdown_conversion_completed",
          documentId: matterDocumentId,
          documentName,
          level: "success",
          message: existingRepresentation?.status === MatterDocumentRepresentationStatus.READY
            ? `Loaded Markdown content for ${documentName}.`
            : `Created Markdown representation for ${documentName}.`,
        });
        progressItems = updateProgressItem(progressItems, matterDocumentId, {
          message: "Waiting to extract chronology facts...",
          phase: "queued",
          percentComplete: 50,
          status: "waiting",
        });
      } else {
        await emitActivity({
          code: "chronology.prepare.document_failed",
          documentId: matterDocumentId,
          documentName,
          level: "error",
          message: `${documentName} could not be converted into AI-readable Markdown.`,
          metadata: {
            representationError: representation.error,
            representationStatus: representation.status,
          },
        });
        progressItems = updateProgressItem(progressItems, matterDocumentId, {
          error: {
            code: "DOCUMENT_PREPARATION_FAILED",
            userMessage: "This document could not be converted into AI-readable Markdown.",
          },
          message: "Failed",
          phase: "failed",
          percentComplete: 100,
          status: "failed",
        });
      }
    } catch (error) {
      console.error("Matter document representation generation failed", {
        error,
        extractionRunId: extractionRun.id,
        matterDocumentId,
        stepId: input.step.id,
        workflowRunId: input.workflowRunId,
      });
      await emitActivity({
        code: "chronology.prepare.document_failed",
        documentId: matterDocumentId,
        documentName,
        level: "error",
        message: `${documentName} could not be converted into AI-readable Markdown.`,
      });
      representationResults.push({
        error: "Internal document representation generation error.",
        fileName: selectedDocument?.fileName ?? matterDocumentId,
        matterDocumentId,
        mimeType: selectedDocument?.mimeType ?? "",
        status: MatterDocumentRepresentationStatus.FAILED,
      });
      progressItems = updateProgressItem(progressItems, matterDocumentId, {
        error: {
          code: "DOCUMENT_PREPARATION_FAILED",
          userMessage: "This document could not be converted into AI-readable Markdown.",
        },
        message: "Failed",
        phase: "failed",
        percentComplete: 100,
        status: "failed",
      });
    }

    await persistRunningProgress({
      currentItemLabel: selectedDocument?.fileName,
      message: "Preparing selected documents...",
    });
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
  for (const documentError of documentErrors) {
    progressItems = updateProgressItem(progressItems, documentError.matterDocumentId, {
      error: {
        code: documentError.code,
        userMessage: documentError.userMessage,
      },
      message: "Failed",
      phase: "failed",
      percentComplete: 100,
      status: "failed",
    });
  }
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
  const readyDocumentById = new Map(
    readyDocuments.map((document) => [
      document.id,
      {
        fileName: document.fileName,
        id: document.id,
        markdown: document.representations[0]?.content ?? "",
      },
    ]),
  );
  let chronologyResult = emptyChronologyResultAggregate();
  const extractionDocumentErrors: WorkflowStepDocumentError[] = [];
  const aiService = readyRepresentationCount > 0
    ? await extractionAIService(input)
    : null;
  const documentConcurrency = chronologyDocumentConcurrency();

  chronologyServiceLog("document extraction phase started", {
    documentConcurrency,
    preparedDocumentCount: preparedDocumentIds.length,
    readyRepresentationCount,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  async function extractPreparedDocument(
    matterDocumentId: string,
  ): Promise<DocumentChronologyExtractionOutcome> {
    const readyDocument = readyDocumentById.get(matterDocumentId);
    const documentName = readyDocument?.fileName ?? matterDocumentId;

    if (!readyDocument?.markdown.trim()) {
      progressItems = updateProgressItem(progressItems, matterDocumentId, {
        error: {
          code: "DOCUMENT_REPRESENTATION_MISSING",
          userMessage: "No AI-readable version was available for this document.",
        },
        message: "Failed",
        phase: "failed",
        percentComplete: 100,
        status: "failed",
      });
      await persistRunningProgress({
        currentItemLabel: readyDocument?.fileName,
        message: "Extracting chronology facts...",
      });
      await emitActivity({
        code: "chronology.prepare.document_failed",
        documentId: matterDocumentId,
        documentName,
        level: "error",
        message: `${documentName} did not have usable Markdown content for extraction.`,
      });
      const documentError: WorkflowStepDocumentError = {
        code: "DOCUMENT_REPRESENTATION_MISSING",
        fileName: readyDocument?.fileName,
        matterDocumentId,
        message: "The ready document representation did not contain Markdown content.",
        userMessage: "No AI-readable version was available for this document.",
      };

      return {
        chronologyResult: emptyChronologyResultAggregate(),
        documentError,
        matterDocumentId,
      };
    }

    progressItems = updateProgressItem(progressItems, matterDocumentId, {
      message: "Extracting chronology facts...",
      phase: "extracting",
      percentComplete: 75,
      status: "running",
    });
    await persistRunningProgress({
      currentItemLabel: readyDocument.fileName,
      message: "Extracting chronology facts...",
    });
    await emitActivity({
      code: "chronology.prepare.extraction_started",
      documentId: matterDocumentId,
      documentName: readyDocument.fileName,
      level: "info",
      message: `Extracting chronology facts from ${readyDocument.fileName}.`,
    });

    chronologyServiceLog("document profile run started", {
      documentId: matterDocumentId,
      fileName: readyDocument.fileName,
      markdownCharacterCount: readyDocument.markdown.length,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });

    const documentChronologyResult = await profile.run({
      aiService: aiService!,
      onWindowProgress: async (event) => {
        const windowMessage = extractionWindowMessage(event);
        const metadata = {
          elapsedMs: event.elapsedMs,
          failedWindowCount: event.failedWindowCount,
          markdownCharacterCount: event.markdownCharacterCount,
          pageEnd: event.pageEnd,
          pageStart: event.pageStart,
          promptCharacterCount: event.promptCharacterCount,
          timeoutMs: event.timeoutMs,
          windowCount: event.windowCount,
          windowIndex: event.windowIndex,
        };

        if (event.status === "started") {
          progressItems = updateProgressItem(progressItems, matterDocumentId, {
            message: windowMessage,
            phase: "extracting",
            percentComplete: extractionWindowPercent(event),
            status: "running",
          });
          await persistRunningProgress({
            currentItemLabel: readyDocument.fileName,
            message: "Extracting chronology facts...",
          });
          await emitActivity({
            code: "chronology.prepare.extraction_window_started",
            documentId: matterDocumentId,
            documentName: readyDocument.fileName,
            level: "info",
            message: `Extracting chronology facts from ${readyDocument.fileName}: ${windowMessage}.`,
            metadata,
          });
          return;
        }

        if (event.status === "completed") {
          const extractedFactCount = event.extractedFactCount ?? 0;
          progressItems = updateProgressItem(progressItems, matterDocumentId, {
            message: `${windowMessage} complete`,
            phase: "extracting",
            percentComplete: extractionWindowPercent({
              ...event,
              windowIndex: event.windowIndex + 1,
            }),
            status: "running",
          });
          await persistRunningProgress({
            currentItemLabel: readyDocument.fileName,
            message: "Extracting chronology facts...",
          });
          await emitActivity({
            code: "chronology.prepare.extraction_window_completed",
            documentId: matterDocumentId,
            documentName: readyDocument.fileName,
            level: "success",
            message: `Extracted ${extractedFactCount} candidate chronology fact${extractedFactCount === 1 ? "" : "s"} from ${readyDocument.fileName}: ${windowMessage}.`,
            metadata: {
              ...metadata,
              extractedFactCount,
            },
          });
          return;
        }

        if (event.status === "waiting") {
          const seconds = elapsedSeconds(event.elapsedMs ?? 0);
          const timeoutSeconds = event.timeoutMs
            ? elapsedSeconds(event.timeoutMs)
            : null;
          const waitingMessage = timeoutSeconds
            ? `${windowMessage}: waiting for AI provider (${seconds}s elapsed; timeout ${timeoutSeconds}s)`
            : `${windowMessage}: waiting for AI provider (${seconds}s elapsed)`;

          progressItems = updateProgressItem(progressItems, matterDocumentId, {
            message: waitingMessage,
            phase: "extracting",
            percentComplete: extractionWindowPercent(event),
            status: "running",
          });
          await persistRunningProgress({
            currentItemLabel: readyDocument.fileName,
            message: "Waiting for AI provider...",
          });
          await emitActivity({
            code: "chronology.prepare.extraction_window_waiting",
            documentId: matterDocumentId,
            documentName: readyDocument.fileName,
            level: "info",
            message: `Still waiting for the AI provider while extracting ${readyDocument.fileName}: ${windowMessage} (${seconds}s elapsed).`,
            metadata,
          });
          return;
        }

        progressItems = updateProgressItem(progressItems, matterDocumentId, {
          message: `${windowMessage} failed`,
          phase: "extracting",
          percentComplete: extractionWindowPercent({
            ...event,
            windowIndex: event.windowIndex + 1,
          }),
          status: "running",
        });
        await persistRunningProgress({
          currentItemLabel: readyDocument.fileName,
          message: "Extracting chronology facts...",
        });
        await emitActivity({
          code: "chronology.prepare.extraction_window_failed",
          documentId: matterDocumentId,
          documentName: readyDocument.fileName,
          level: "error",
          message: event.errorUserMessage ??
            `Chronology extraction failed for ${readyDocument.fileName}: ${windowMessage}.`,
          metadata: {
            ...metadata,
            error: event.error,
            errorCode: event.errorCode,
            errorProvider: event.errorProvider,
            errorStatus: event.errorStatus,
            errorUserMessage: event.errorUserMessage,
          },
        });
      },
      readyDocuments: [readyDocument],
    });

    chronologyServiceLog("document profile run completed", {
      documentId: matterDocumentId,
      errorCode: documentChronologyResult.errorCode,
      extractedFactCount: documentChronologyResult.extractedFactCount,
      extractionWindowCount: documentChronologyResult.extractionWindowCount,
      failedWindowCount: documentChronologyResult.failedWindowCount,
      fileName: readyDocument.fileName,
      status: documentChronologyResult.status,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });

    if (documentChronologyResult.status !== "COMPLETED") {
      const userMessage =
        "The chronology extraction provider could not process this document.";
      progressItems = updateProgressItem(progressItems, matterDocumentId, {
        error: {
          code: "EXTRACTION_PROVIDER_FAILED",
          userMessage,
        },
        message: "Failed",
        phase: "failed",
        percentComplete: 100,
        status: "failed",
      });
      await emitActivity({
        code: "chronology.prepare.document_failed",
        documentId: matterDocumentId,
        documentName: readyDocument.fileName,
        level: "error",
        message: `Chronology extraction failed for ${readyDocument.fileName}.`,
        metadata: {
          errorCode: documentChronologyResult.errorCode,
          error: documentChronologyResult.error,
          errorProvider: documentChronologyResult.errorProvider,
          errorStatus: documentChronologyResult.errorStatus,
          errorUserMessage: documentChronologyResult.errorUserMessage,
          extractedFactCount: documentChronologyResult.extractedFactCount,
          failedWindowCount: documentChronologyResult.failedWindowCount,
        },
      });
      const documentError = {
        code: documentChronologyResult.errorCode ?? "EXTRACTION_PROVIDER_FAILED",
        fileName: readyDocument.fileName,
        matterDocumentId,
        message: documentChronologyResult.error ??
          "The chronology extraction provider failed for this document.",
        userMessage: documentChronologyResult.errorUserMessage ?? userMessage,
      };
      await persistRunningProgress({
        currentItemLabel: readyDocument.fileName,
        message: "Extracting chronology facts...",
      });

      return {
        chronologyResult: documentChronologyResult,
        documentError,
        matterDocumentId,
      };
    }

    await emitActivity({
      code: "chronology.prepare.extraction_completed",
      documentId: matterDocumentId,
      documentName: readyDocument.fileName,
      level: "success",
      message: `Extracted ${documentChronologyResult.extractedFactCount} candidate chronology fact${documentChronologyResult.extractedFactCount === 1 ? "" : "s"} from ${readyDocument.fileName}.`,
      metadata: {
        extractedFactCount: documentChronologyResult.extractedFactCount,
        extractionWindowCount: documentChronologyResult.extractionWindowCount,
        factsByType: documentChronologyResult.factsByType,
      },
    });
    progressItems = updateProgressItem(progressItems, matterDocumentId, {
      message: "Prepared",
      phase: "completed",
      percentComplete: 100,
      status: "completed",
    });
    await emitActivity({
      code: "chronology.prepare.document_completed",
      documentId: matterDocumentId,
      documentName: readyDocument.fileName,
      level: "success",
      message: `Prepared ${readyDocument.fileName}.`,
    });
    await persistRunningProgress({
      currentItemLabel: readyDocument.fileName,
      message: "Extracting chronology facts...",
    });

    return {
      chronologyResult: documentChronologyResult,
      documentError: null,
      matterDocumentId,
    };
  }

  const documentExtractionOutcomes = await runBoundedParallel({
    concurrency: documentConcurrency,
    items: preparedDocumentIds,
    worker: async (matterDocumentId) => extractPreparedDocument(matterDocumentId),
  });

  for (const outcome of documentExtractionOutcomes) {
    chronologyResult = mergeChronologyResult(
      chronologyResult,
      outcome.chronologyResult,
    );

    if (outcome.documentError) {
      extractionDocumentErrors.push(outcome.documentError);
    }

    chronologyServiceLog("document result merged", {
      aggregateStatus: chronologyResult.status,
      documentId: outcome.matterDocumentId,
      extractedFactCount: chronologyResult.extractedFactCount,
      failedWindowCount: chronologyResult.failedWindowCount,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });
  }

  if (readyRepresentationCount === 0) {
    chronologyResult = {
      ...emptyChronologyResultAggregate(),
      error: "No selected documents could be prepared for extraction.",
      status: "FAILED",
    };
  } else if (chronologyResult.extractionWindowCount === 0) {
    chronologyResult = {
      ...chronologyResult,
      error: chronologyResult.error ?? "No selected documents had extractable Markdown content.",
      status: "FAILED",
    };
  }
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
  const allDocumentErrors = [...documentErrors, ...extractionDocumentErrors];
  const structuredError =
    extractionStepErrorForDocuments({
      documentErrors: allDocumentErrors,
      partial:
        (readyRepresentationCount > 0 && failedRepresentationCount > 0) ||
        (extractionDocumentErrors.length > 0 &&
          chronologyResult.extractedFactCount > 0),
    }) ??
    (chronologyResult.error ? extractionProviderError(chronologyResult.error) : null);

  chronologyServiceLog("postprocess started", {
    documentErrorCount: allDocumentErrors.length,
    extractedFactCount: chronologyResult.facts.length,
    status,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  const chronologyPostprocessResult = buildChronologyPostprocessResult(
    chronologyResult.facts,
  );

  chronologyServiceLog("postprocess completed", {
    artifactMarkdownCharacterCount:
      chronologyPostprocessResult.artifactMarkdown?.length ?? 0,
    collapsedEventCount: chronologyPostprocessResult.collapsedEventCount,
    datedCollapsedEventCount: chronologyPostprocessResult.datedCollapsedEventCount,
    generatedFromFactCount: chronologyPostprocessResult.generatedFromFactCount,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  let chronologyArtifact = null;

  if (
    chronologyPostprocessResult.artifactMarkdown &&
    chronologyPostprocessResult.collapsedEventCount > 0
  ) {
    chronologyServiceLog("artifact creation started", {
      collapsedEventCount: chronologyPostprocessResult.collapsedEventCount,
      contentCharacterCount: chronologyPostprocessResult.artifactMarkdown.length,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });
    chronologyArtifact = await createWorkflowMarkdownArtifact({
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
    });
    chronologyServiceLog("artifact creation completed", {
      artifactId: chronologyArtifact.id,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });
  } else {
    chronologyServiceLog("artifact creation skipped", {
      collapsedEventCount: chronologyPostprocessResult.collapsedEventCount,
      hasArtifactMarkdown: Boolean(chronologyPostprocessResult.artifactMarkdown),
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });
  }
  const finalPreparedDocumentIds = progressItems
    .filter((item) => item.status === "completed")
    .map((item) => item.id);
  const finalFailedDocumentIds = progressItems
    .filter((item) => item.status === "failed")
    .map((item) => item.id);
  const finalProgress = buildProgress({
    items: progressItems,
    message: status === WorkflowExtractionRunStatus.COMPLETED
      ? "Preparation complete."
      : status === WorkflowExtractionRunStatus.PARTIAL_FAILED
        ? "Some documents could not be prepared."
        : "Preparation failed.",
    status: outputStatusFromRunStatus(status),
  });
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
    failedDocumentIds: finalFailedDocumentIds.length > 0
      ? finalFailedDocumentIds
      : failedDocumentIds,
    failedRepresentationCount,
    preparedDocumentIds: finalPreparedDocumentIds,
    profile: config.profile,
    progress: finalProgress,
    readyRepresentationCount,
    schemaVersion: 1,
    selectedMatterDocumentIds,
    status: outputStatusFromRunStatus(status),
  };

  chronologyServiceLog("extraction run update started", {
    extractionRunId: extractionRun.id,
    outputStatus: output.status,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

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

  chronologyServiceLog("extraction run update completed", {
    extractionRunId: extractionRun.id,
    outputStatus: output.status,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  chronologyServiceLog("terminal activity emission started", {
    outputStatus: output.status,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  if (output.status === "completed") {
    await emitActivity({
      code: "chronology.prepare.completed",
      level: "success",
      message: "All selected documents prepared.",
      metadata: {
        extractedFactCount: output.extractedFactCount,
        selectedDocumentCount: selectedMatterDocumentIds.length,
      },
    });
    await emitActivity({
      code: "chronology.prepare.moving_to_review",
      level: "info",
      message: "Moving to Review chronology.",
      metadata: {
        chronologyArtifactId: output.chronologyArtifactId,
      },
    });
  } else if (output.status === "partial_failed") {
    await emitActivity({
      code: "chronology.prepare.failed",
      level: "warning",
      message: `Preparation partially failed. ${output.preparedDocumentIds.length} of ${selectedMatterDocumentIds.length} documents were prepared.`,
      metadata: {
        failedDocumentIds: output.failedDocumentIds,
      },
    });
  } else {
    await emitActivity({
      code: "chronology.prepare.failed",
      level: "error",
      message: "Preparation failed. No chronology draft was created.",
      metadata: {
        failedDocumentIds: output.failedDocumentIds,
      },
    });
  }

  chronologyServiceLog("terminal activity emission completed", {
    outputStatus: output.status,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  chronologyServiceLog("final output write started", {
    extractionRunId: extractionRun.id,
    outputStatus: output.status,
    preparedDocumentCount: output.preparedDocumentIds.length,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  await writeWorkflowStepOutput({
    outputJson: output,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  chronologyServiceLog("final output write completed", {
    extractionRunId: extractionRun.id,
    outputStatus: output.status,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  return output;
}
