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
import type { ConfiguredAISettings } from "@/services/ai/ai-settings-service";
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
  effectiveWorkflowStepProvider,
  resolveWorkflowStepAIProvider,
  type EffectiveWorkflowStepProvider,
} from "@/services/workflows/workflow-step-settings-service";
import {
  activeProgressItem,
  completedProgressItemCount,
  progressPercentFromItems,
  type WorkflowStepProgress,
  type WorkflowStepProgressItem,
} from "@/services/workflows/workflow-step-progress";
import type { WorkflowStepDefinition } from "@/services/workflows/types";
import { extractionRepresentationDisplayState } from "@/workflow-steps/extraction/display-state";
import { runExtractionProfile } from "@/workflow-steps/extraction/profile-runner";
import { getExtractionProfile } from "@/workflow-steps/extraction/profiles";
import type { ExtractionProfileRunResult } from "@/workflow-steps/extraction/types";
import {
  normalizeExtractionStepConfig,
  type ExtractionStepOutput,
} from "@/workflow-steps/extraction/schema";
import {
  documentRepresentationError,
  EXTRACTION_DOCUMENT_JSON_PARSE_USER_MESSAGE,
  EXTRACTION_DOCUMENT_PROVIDER_USER_MESSAGE,
  EXTRACTION_DOCUMENT_SCHEMA_VALIDATION_USER_MESSAGE,
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

type ExtractionResultAggregate = ExtractionProfileRunResult<unknown>;

type ExtractionExecutionOptions = {
  ignoreExistingRunning?: boolean;
};

type DocumentProfileExtractionOutcome = {
  profileResult: ExtractionResultAggregate;
  documentError: WorkflowStepDocumentError | null;
  matterDocumentId: string;
};

export type ExtractionStepState = {
  activityEvents: WorkflowActivityEvent[];
  documents: ExtractionDocumentState[];
  effectiveAIProvider: EffectiveWorkflowStepProvider | null;
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
  aiServiceFactory?: (settings: ConfiguredAISettings) => RunExtractionStepInput["aiService"];
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
  return {};
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

function extractionServiceLog(message: string, metadata: Record<string, unknown> = {}) {
  console.info(`[extraction:service] ${message}`, metadata);
}

function extractionDocumentConcurrency() {
  const rawValue = process.env.MATTER_LAYER_EXTRACTION_DOCUMENT_CONCURRENCY;

  if (!rawValue) {
    return 3;
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    throw new Error(
      "MATTER_LAYER_EXTRACTION_DOCUMENT_CONCURRENCY must be a positive integer.",
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
  outputKey: ExtractionStepOutput["outputKey"];
  profile: ExtractionStepOutput["profile"];
  workflowRunId: string;
}): ExtractionStepOutput {
  return {
    artifactReferences: {},
    collapsedEventCount: 0,
    collapsedEvents: [],
    documentResults: [],
    error: null,
    extractedFactCount: 0,
    extractionRunId: `autorun-starting-${input.workflowRunId}`,
    extractionWarnings: [],
    extractionWindowCount: 0,
    facts: [],
    factsByType: emptyFactsByType(),
    failedDocumentIds: [],
    failedRepresentationCount: 0,
    preparedDocumentIds: [],
    outputKey: input.outputKey,
    profile: input.profile,
    profileOutput: null,
    progress: {
      completedItems: 0,
      items: [],
      message: "Starting extraction preparation...",
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
  outputKey: ExtractionStepOutput["outputKey"];
  progress?: WorkflowStepProgress | null;
  profile: ExtractionStepOutput["profile"];
  readyRepresentationCount: number;
  selectedMatterDocumentIds: string[];
}): ExtractionStepOutput {
  return {
    artifactReferences: {},
    collapsedEventCount: 0,
    collapsedEvents: [],
    documentResults: [],
    error: input.error,
    extractedFactCount: 0,
    extractionRunId: input.extractionRunId,
    extractionWarnings: [],
    extractionWindowCount: 0,
    facts: [],
    factsByType: emptyFactsByType(),
    failedDocumentIds: input.selectedMatterDocumentIds,
    failedRepresentationCount: input.failedRepresentationCount,
    preparedDocumentIds: [],
    outputKey: input.outputKey,
    profile: input.profile,
    profileOutput: null,
    progress: input.progress ?? null,
    readyRepresentationCount: input.readyRepresentationCount,
    schemaVersion: 1,
    selectedMatterDocumentIds: input.selectedMatterDocumentIds,
    status: "failed",
  };
}

function runningOutput(input: {
  extractionRunId: string;
  outputKey: ExtractionStepOutput["outputKey"];
  progress: WorkflowStepProgress;
  profile: ExtractionStepOutput["profile"];
  selectedMatterDocumentIds: string[];
}): ExtractionStepOutput {
  return {
    artifactReferences: {},
    collapsedEventCount: 0,
    collapsedEvents: [],
    documentResults: [],
    error: null,
    extractedFactCount: 0,
    extractionRunId: input.extractionRunId,
    extractionWarnings: [],
    extractionWindowCount: 0,
    facts: [],
    factsByType: emptyFactsByType(),
    failedDocumentIds: [],
    failedRepresentationCount: 0,
    preparedDocumentIds: [],
    outputKey: input.outputKey,
    profile: input.profile,
    profileOutput: null,
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

function emptyExtractionResultAggregate(): ExtractionResultAggregate {
  return {
    error: null,
    errorCode: null,
    errorKind: null,
    errorProvider: null,
    errorStatus: null,
    errorUserMessage: null,
    failedWindowCount: 0,
    itemCount: 0,
    itemCountsByType: emptyFactsByType(),
    items: [],
    model: null,
    provider: null,
    status: "COMPLETED",
    warnings: [],
    windowCount: 0,
  };
}

function mergeExtractionResult(
  aggregate: ExtractionResultAggregate,
  nextResult: ExtractionResultAggregate,
): ExtractionResultAggregate {
  const itemCountsByType = {
    ...aggregate.itemCountsByType,
  };

  for (const [itemType, count] of Object.entries(nextResult.itemCountsByType)) {
    itemCountsByType[itemType] = (itemCountsByType[itemType] ?? 0) + count;
  }

  const failedWindowCount = aggregate.failedWindowCount + nextResult.failedWindowCount;
  const windowCount = aggregate.windowCount + nextResult.windowCount;
  const itemCount = aggregate.itemCount + nextResult.itemCount;
  let status: ExtractionResultAggregate["status"] = "COMPLETED";

  if (windowCount === 0 || failedWindowCount === windowCount) {
    status = "FAILED";
  } else if (failedWindowCount > 0) {
    status = "PARTIAL_FAILED";
  }

  return {
    error: aggregate.error ?? nextResult.error,
    errorCode: aggregate.errorCode ?? nextResult.errorCode,
    errorKind: aggregate.errorKind ?? nextResult.errorKind,
    errorProvider: aggregate.errorProvider ?? nextResult.errorProvider,
    errorStatus: aggregate.errorStatus ?? nextResult.errorStatus,
    errorUserMessage: aggregate.errorUserMessage ?? nextResult.errorUserMessage,
    failedWindowCount,
    itemCount,
    itemCountsByType,
    items: [...aggregate.items, ...nextResult.items],
    model: aggregate.model ?? nextResult.model,
    provider: aggregate.provider ?? nextResult.provider,
    status,
    warnings: [
      ...aggregate.warnings,
      ...nextResult.warnings,
    ],
    windowCount,
  };
}

function documentUserMessageForExtractionError(
  result: ExtractionResultAggregate,
) {
  if (result.errorKind === "json_parse") {
    return EXTRACTION_DOCUMENT_JSON_PARSE_USER_MESSAGE;
  }

  if (result.errorKind === "schema_validation") {
    return EXTRACTION_DOCUMENT_SCHEMA_VALIDATION_USER_MESSAGE;
  }

  if (result.errorCode?.startsWith("AI_PROVIDER_") && result.errorUserMessage) {
    return result.errorUserMessage;
  }

  return EXTRACTION_DOCUMENT_PROVIDER_USER_MESSAGE;
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

function testExtractionAIServiceFromEnv(): NonNullable<RunExtractionStepInput["aiService"]> | null {
  const content = process.env.MATTER_LAYER_TEST_EXTRACTION_AI_RESPONSE;

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

export async function createExtractionAIService(input: RunExtractionStepInput) {
  if (input.aiService) {
    return input.aiService;
  }

  const testAIService = testExtractionAIServiceFromEnv();

  if (testAIService) {
    return testAIService;
  }

  const { createAIService } = await import("@/services/ai/ai-service");
  const { createAIServiceFromSettings } = await import("@/services/ai/ai-service");

  try {
    const resolvedProvider = await resolveWorkflowStepAIProvider({
      stepId: input.step.id,
      workflowId: input.workflowDefinitionId,
    });

    if (resolvedProvider.warning) {
      console.warn("[extraction] AI Provider override warning", {
        source: resolvedProvider.source,
        stepId: input.step.id,
        warning: resolvedProvider.warning,
        workflowDefinitionId: input.workflowDefinitionId,
        workflowRunId: input.workflowRunId,
      });
    }

    if (input.aiServiceFactory) {
      return input.aiServiceFactory(resolvedProvider.settings);
    }

    if (resolvedProvider.source === "override") {
      return createAIServiceFromSettings(resolvedProvider.settings);
    }

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
          extractionTaskId: config.taskId,
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
    outputKey: config.outputKey,
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
  extractionServiceLog("recovery output write completed", {
    errorCode: error.code,
    extractionRunId,
    outputStatus: output.status,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });
  await emitWorkflowActivityEvent({
    code: "extraction.prepare.failed",
    level: "error",
    message: `Preparation failed: ${errorMessage}`,
    metadata: {
      extractionTaskId: config.taskId,
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
  const [
    documents,
    latestOutput,
    latestRun,
    activityEvents,
    effectiveAIProvider,
  ] = await Promise.all([
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
    effectiveWorkflowStepProvider({
      stepId: input.step.id,
      workflowId: input.workflowDefinitionId,
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
    effectiveAIProvider,
    latestRunStatus: latestRun?.status ?? null,
  };
}

export async function runExtractionStep(
  input: RunExtractionStepInput,
): Promise<ExtractionStepOutput> {
  const config = normalizeExtractionStepConfig(input.step.parameters);
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
    outputKey: config.outputKey,
    profile: config.profile,
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
    code: "extraction.prepare.started",
    level: "info",
    message: "Started extraction preparation.",
    metadata: {
      extractionTaskId: config.taskId,
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
          extractionTaskId: config.taskId,
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
      outputKey: config.outputKey,
      progress: buildProgress({
        items: [],
        message: "Preparation failed.",
        status: "failed",
      }),
      profile: config.profile,
      readyRepresentationCount: 0,
      selectedMatterDocumentIds,
    });

    console.error("Extraction preparation failed", {
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
      code: "extraction.prepare.failed",
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
      code: "extraction.prepare.selected_documents_loaded",
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
          extractionTaskId: config.taskId,
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
      outputKey: config.outputKey,
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

    console.error("Extraction preparation failed", {
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
      code: "extraction.prepare.failed",
      level: "error",
      message: "Preparation failed. One or more selected documents were not available in this matter.",
      metadata: {
        missingDocumentCount: missingDocumentIds.length,
      },
    });

    return output;
  }
  await emitActivity({
    code: "extraction.prepare.selected_documents_loaded",
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
          extractionTaskId: config.taskId,
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
      outputKey: config.outputKey,
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
      code: "extraction.prepare.document_started",
      documentId: matterDocumentId,
      documentName,
      level: "info",
      message: `Checking ${documentName}.`,
    });

    await emitActivity({
      code: "extraction.prepare.representation_lookup_started",
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
        code: "extraction.prepare.representation_found",
        documentId: matterDocumentId,
        documentName,
        level: "info",
        message: `Found existing Markdown representation for ${documentName}.`,
      });
    } else {
      await emitActivity({
        code: "extraction.prepare.representation_missing",
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
      code: "extraction.prepare.document_content_lookup_started",
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
        code: "extraction.prepare.markdown_conversion_started",
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
            ? "extraction.prepare.document_content_found"
            : "extraction.prepare.markdown_conversion_completed",
          documentId: matterDocumentId,
          documentName,
          level: "success",
          message: existingRepresentation?.status === MatterDocumentRepresentationStatus.READY
            ? `Loaded Markdown content for ${documentName}.`
            : `Created Markdown representation for ${documentName}.`,
        });
        progressItems = updateProgressItem(progressItems, matterDocumentId, {
          message: `Waiting to extract ${profile.itemPluralLabel}...`,
          phase: "queued",
          percentComplete: 50,
          status: "waiting",
        });
      } else {
        await emitActivity({
          code: "extraction.prepare.document_failed",
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
        code: "extraction.prepare.document_failed",
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
  let profileResult = emptyExtractionResultAggregate();
  const extractionDocumentErrors: WorkflowStepDocumentError[] = [];
  const aiService = readyRepresentationCount > 0
    ? await createExtractionAIService(input)
    : null;
  const documentConcurrency = extractionDocumentConcurrency();

  extractionServiceLog("document extraction phase started", {
    documentConcurrency,
    preparedDocumentCount: preparedDocumentIds.length,
    readyRepresentationCount,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  async function extractPreparedDocument(
    matterDocumentId: string,
  ): Promise<DocumentProfileExtractionOutcome> {
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
        message: `Extracting ${profile.itemPluralLabel}...`,
      });
      await emitActivity({
        code: "extraction.prepare.document_failed",
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
        documentError,
        matterDocumentId,
        profileResult: emptyExtractionResultAggregate(),
      };
    }

    progressItems = updateProgressItem(progressItems, matterDocumentId, {
      message: `Extracting ${profile.itemPluralLabel}...`,
      phase: "extracting",
      percentComplete: 75,
      status: "running",
    });
    await persistRunningProgress({
      currentItemLabel: readyDocument.fileName,
      message: `Extracting ${profile.itemPluralLabel}...`,
    });
    await emitActivity({
      code: "extraction.prepare.extraction_started",
      documentId: matterDocumentId,
      documentName: readyDocument.fileName,
      level: "info",
      message: `Extracting ${profile.itemPluralLabel} from ${readyDocument.fileName}.`,
    });

    extractionServiceLog("document profile run started", {
      documentId: matterDocumentId,
      fileName: readyDocument.fileName,
      markdownCharacterCount: readyDocument.markdown.length,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });

    const documentProfileResult = await runExtractionProfile(profile, {
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
            message: `Extracting ${profile.itemPluralLabel}...`,
          });
          await emitActivity({
            code: "extraction.prepare.extraction_window_started",
            documentId: matterDocumentId,
            documentName: readyDocument.fileName,
            level: "info",
            message: `Extracting ${profile.itemPluralLabel} from ${readyDocument.fileName}: ${windowMessage}.`,
            metadata,
          });
          return;
        }

        if (event.status === "completed") {
          const extractedItemCount = event.extractedItemCount ?? 0;
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
            message: `Extracting ${profile.itemPluralLabel}...`,
          });
          await emitActivity({
            code: "extraction.prepare.extraction_window_completed",
            documentId: matterDocumentId,
            documentName: readyDocument.fileName,
            level: "success",
            message: `Extracted ${extractedItemCount} candidate ${extractedItemCount === 1 ? profile.itemLabel : profile.itemPluralLabel} from ${readyDocument.fileName}: ${windowMessage}.`,
            metadata: {
              ...metadata,
              extractedItemCount,
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
            code: "extraction.prepare.extraction_window_waiting",
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
          message: `Extracting ${profile.itemPluralLabel}...`,
        });
        await emitActivity({
          code: "extraction.prepare.extraction_window_failed",
          documentId: matterDocumentId,
          documentName: readyDocument.fileName,
          level: "error",
          message: event.errorUserMessage ??
            `Extraction failed for ${readyDocument.fileName}: ${windowMessage}.`,
          metadata: {
            ...metadata,
            error: event.error,
            errorCode: event.errorCode,
            errorKind: event.errorKind,
            errorProvider: event.errorProvider,
            errorStatus: event.errorStatus,
            errorUserMessage: event.errorUserMessage,
          },
        });
      },
      readyDocuments: [readyDocument],
    });

    extractionServiceLog("document profile run completed", {
      documentId: matterDocumentId,
      errorCode: documentProfileResult.errorCode,
      itemCount: documentProfileResult.itemCount,
      windowCount: documentProfileResult.windowCount,
      failedWindowCount: documentProfileResult.failedWindowCount,
      fileName: readyDocument.fileName,
      status: documentProfileResult.status,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });

    if (documentProfileResult.status !== "COMPLETED") {
      const userMessage = documentUserMessageForExtractionError(documentProfileResult);
      progressItems = updateProgressItem(progressItems, matterDocumentId, {
        error: {
          code: documentProfileResult.errorCode ?? "EXTRACTION_PROVIDER_FAILED",
          userMessage,
        },
        message: "Failed",
        phase: "failed",
        percentComplete: 100,
        status: "failed",
      });
      await emitActivity({
        code: "extraction.prepare.document_failed",
        documentId: matterDocumentId,
        documentName: readyDocument.fileName,
        level: "error",
        message: `Extraction failed for ${readyDocument.fileName}.`,
        metadata: {
          errorCode: documentProfileResult.errorCode,
          errorKind: documentProfileResult.errorKind,
          error: documentProfileResult.error,
          errorProvider: documentProfileResult.errorProvider,
          errorStatus: documentProfileResult.errorStatus,
          errorUserMessage: documentProfileResult.errorUserMessage,
          itemCount: documentProfileResult.itemCount,
          failedWindowCount: documentProfileResult.failedWindowCount,
        },
      });
      const documentError = {
        code: documentProfileResult.errorCode ?? "EXTRACTION_PROVIDER_FAILED",
        fileName: readyDocument.fileName,
        matterDocumentId,
        message: documentProfileResult.error ??
          "The extraction provider failed for this document.",
        userMessage,
      };
      await persistRunningProgress({
        currentItemLabel: readyDocument.fileName,
        message: `Extracting ${profile.itemPluralLabel}...`,
      });

      return {
        documentError,
        matterDocumentId,
        profileResult: documentProfileResult,
      };
    }

    await emitActivity({
      code: "extraction.prepare.extraction_completed",
      documentId: matterDocumentId,
      documentName: readyDocument.fileName,
      level: "success",
      message: `Extracted ${documentProfileResult.itemCount} candidate ${documentProfileResult.itemCount === 1 ? profile.itemLabel : profile.itemPluralLabel} from ${readyDocument.fileName}.`,
      metadata: {
        itemCount: documentProfileResult.itemCount,
        itemCountsByType: documentProfileResult.itemCountsByType,
        windowCount: documentProfileResult.windowCount,
      },
    });
    progressItems = updateProgressItem(progressItems, matterDocumentId, {
      message: "Prepared",
      phase: "completed",
      percentComplete: 100,
      status: "completed",
    });
    await emitActivity({
      code: "extraction.prepare.document_completed",
      documentId: matterDocumentId,
      documentName: readyDocument.fileName,
      level: "success",
      message: `Prepared ${readyDocument.fileName}.`,
    });
    await persistRunningProgress({
      currentItemLabel: readyDocument.fileName,
      message: `Extracting ${profile.itemPluralLabel}...`,
    });

    return {
      documentError: null,
      matterDocumentId,
      profileResult: documentProfileResult,
    };
  }

  const documentExtractionOutcomes = await runBoundedParallel({
    concurrency: documentConcurrency,
    items: preparedDocumentIds,
    worker: async (matterDocumentId) => extractPreparedDocument(matterDocumentId),
  });

  for (const outcome of documentExtractionOutcomes) {
    profileResult = mergeExtractionResult(
      profileResult,
      outcome.profileResult,
    );

    if (outcome.documentError) {
      extractionDocumentErrors.push(outcome.documentError);
    }

    extractionServiceLog("document result merged", {
      aggregateStatus: profileResult.status,
      documentId: outcome.matterDocumentId,
      itemCount: profileResult.itemCount,
      failedWindowCount: profileResult.failedWindowCount,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });
  }

  if (readyRepresentationCount === 0) {
    profileResult = {
      ...emptyExtractionResultAggregate(),
      error: "No selected documents could be prepared for extraction.",
      status: "FAILED",
    };
  } else if (profileResult.windowCount === 0) {
    profileResult = {
      ...profileResult,
      error: profileResult.error ?? "No selected documents had extractable Markdown content.",
      status: "FAILED",
    };
  }
  const profileStatus = prismaStatusFromPluginStatus(profileResult.status);
  const status =
    failedRepresentationCount > 0 &&
    profileStatus === WorkflowExtractionRunStatus.COMPLETED
      ? WorkflowExtractionRunStatus.PARTIAL_FAILED
      : profileStatus;
  const firstError =
    representationResults.find((result) => result.error)?.error ??
    profileResult.error;
  if (firstError) {
    console.error("Extraction preparation failed", {
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
          profileResult.itemCount > 0),
    }) ??
    (profileResult.error ? extractionProviderError(profileResult.error) : null);

  extractionServiceLog("postprocess started", {
    documentErrorCount: allDocumentErrors.length,
    itemCount: profileResult.items.length,
    status,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  const postprocessResult = profile.postProcess
    ? profile.postProcess({
        items: profileResult.items,
        runResult: profileResult,
      })
    : {
        displayItems: profileResult.items.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item),
        ),
        itemCount: profileResult.itemCount,
        itemCountsByType: profileResult.itemCountsByType,
        profileOutput: {
          items: profileResult.items,
        },
      };

  extractionServiceLog("postprocess completed", {
    artifactCount: postprocessResult.artifacts?.length ?? 0,
    itemCount: postprocessResult.itemCount,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  const artifactReferences: Record<string, string | null> = {};

  for (const artifact of postprocessResult.artifacts ?? []) {
    extractionServiceLog("artifact creation started", {
      contentCharacterCount: artifact.content.length,
      outputKey: artifact.outputKey,
      stepId: input.step.id,
      workflowRunId: input.workflowRunId,
    });
    const createdArtifact = await createWorkflowMarkdownArtifact({
      content: artifact.content,
      matterId: input.matterId,
      metadataJson: {
        extractionRunId: extractionRun.id,
        profile: config.profile,
        sourceDocumentCount: selectedMatterDocumentIds.length,
        ...(artifact.metadataJson && typeof artifact.metadataJson === "object"
          ? artifact.metadataJson
          : {}),
      },
      stepId: input.step.id,
      title: artifact.title,
      workflowRunId: input.workflowRunId,
    });
    artifactReferences[artifact.outputKey] = createdArtifact.id;
    extractionServiceLog("artifact creation completed", {
      artifactId: createdArtifact.id,
      outputKey: artifact.outputKey,
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
    artifactReferences,
    collapsedEventCount: postprocessResult.stepOutputPatch?.collapsedEventCount ?? 0,
    collapsedEvents: postprocessResult.stepOutputPatch?.collapsedEvents ?? [],
    documentResults: documentExtractionOutcomes.map((outcome) => ({
      documentError: outcome.documentError,
      itemCount: outcome.profileResult.itemCount,
      matterDocumentId: outcome.matterDocumentId,
      status: outcome.profileResult.status,
      windowCount: outcome.profileResult.windowCount,
    })),
    error: structuredError,
    extractedFactCount:
      postprocessResult.stepOutputPatch?.extractedFactCount ?? profileResult.itemCount,
    extractionWarnings: profileResult.warnings,
    extractionWindowCount: profileResult.windowCount,
    extractionRunId: extractionRun.id,
    facts: postprocessResult.stepOutputPatch?.facts ??
      postprocessResult.displayItems ?? [],
    factsByType:
      postprocessResult.stepOutputPatch?.factsByType ??
      postprocessResult.itemCountsByType,
    failedDocumentIds: finalFailedDocumentIds.length > 0
      ? finalFailedDocumentIds
      : failedDocumentIds,
    failedRepresentationCount,
    preparedDocumentIds: finalPreparedDocumentIds,
    outputKey: config.outputKey,
    profile: config.profile,
    profileOutput: postprocessResult.profileOutput,
    progress: finalProgress,
    readyRepresentationCount,
    schemaVersion: 1,
    selectedMatterDocumentIds,
    status: outputStatusFromRunStatus(status),
  };
  if (config.outputKey) {
    output[config.outputKey] = postprocessResult.profileOutput;
  }
  for (const [outputKey, artifactId] of Object.entries(artifactReferences)) {
    output[outputKey] = artifactId;
  }

  extractionServiceLog("extraction run update started", {
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
        aiModel: profileResult.model,
        aiProvider: profileResult.provider,
        artifactReferences,
        ...postprocessResult.artifactMetadata,
        documentRepresentations: representationResults,
        itemCount: profileResult.itemCount,
        itemCountsByType: profileResult.itemCountsByType,
        warnings: profileResult.warnings,
        windowCount: profileResult.windowCount,
        failedRepresentationCount,
        failedWindowCount: profileResult.failedWindowCount,
        firstErrorKind: profileResult.errorKind,
        profileDescription: profile.description,
        profileLabel: profile.label,
        readyRepresentationCount,
        selectedDocumentCount: selectedMatterDocumentIds.length,
      }),
      status,
    },
    where: {
      id: extractionRun.id,
    },
  });

  extractionServiceLog("extraction run update completed", {
    extractionRunId: extractionRun.id,
    outputStatus: output.status,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  extractionServiceLog("terminal activity emission started", {
    outputStatus: output.status,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  if (output.status === "completed") {
    await emitActivity({
      code: "extraction.prepare.completed",
      level: "success",
      message: "All selected documents prepared.",
      metadata: {
        itemCount: profileResult.itemCount,
        selectedDocumentCount: selectedMatterDocumentIds.length,
      },
    });
    if (Object.keys(artifactReferences).length > 0) {
      await emitActivity({
        code: "extraction.prepare.artifacts_created",
        level: "info",
        message: "Generated extraction artifact.",
        metadata: {
          artifactReferences,
        },
      });
    }
  } else if (output.status === "partial_failed") {
    await emitActivity({
      code: "extraction.prepare.failed",
      level: "warning",
      message: `Preparation partially failed. ${output.preparedDocumentIds.length} of ${selectedMatterDocumentIds.length} documents were prepared.`,
      metadata: {
        failedDocumentIds: output.failedDocumentIds,
      },
    });
  } else {
    await emitActivity({
      code: "extraction.prepare.failed",
      level: "error",
      message: "Preparation failed. No extraction artifact was created.",
      metadata: {
        failedDocumentIds: output.failedDocumentIds,
      },
    });
  }

  extractionServiceLog("terminal activity emission completed", {
    outputStatus: output.status,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  extractionServiceLog("final output write started", {
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

  extractionServiceLog("final output write completed", {
    extractionRunId: extractionRun.id,
    outputStatus: output.status,
    stepId: input.step.id,
    workflowRunId: input.workflowRunId,
  });

  return output;
}
