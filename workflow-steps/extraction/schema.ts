import type { WorkflowStepError } from "@/services/workflows/workflow-step-errors";
import type { WorkflowStepProgress } from "@/services/workflows/workflow-step-progress";
import type { ExtractionWarning } from "./types";
import type { ExtractionProfileUICopy } from "./types";

export const EXTRACTION_REPRESENTATION_TYPES = ["MARKDOWN"] as const;

export type ExtractionRepresentationType =
  (typeof EXTRACTION_REPRESENTATION_TYPES)[number];
export type ExtractionProfileId = string;

export type ExtractionStepConfig = {
  inputStepId: string;
  outputKey: string | null;
  profile: ExtractionProfileId;
  representationType: ExtractionRepresentationType;
  taskId: string;
  ui: ExtractionProfileUICopy;
};

export type ExtractionStepOutputStatus =
  | "completed"
  | "failed"
  | "partial_failed"
  | "running";

export type ExtractionStepOutput = {
  [key: string]: unknown;
  artifactReferences: Record<string, string | null>;
  collapsedEventCount: number;
  collapsedEvents: Array<Record<string, unknown>>;
  documentResults: Array<Record<string, unknown>>;
  extractedFactCount: number;
  extractionWarnings: ExtractionWarning[];
  extractionWindowCount: number;
  extractionRunId: string;
  error: WorkflowStepError | null;
  facts: Array<Record<string, unknown>>;
  factsByType: Record<string, number>;
  failedDocumentIds: string[];
  failedRepresentationCount: number;
  preparedDocumentIds: string[];
  outputKey: string | null;
  profile: ExtractionProfileId;
  profileOutput: unknown;
  progress: WorkflowStepProgress | null;
  readyRepresentationCount: number;
  schemaVersion: 1;
  selectedMatterDocumentIds: string[];
  status: ExtractionStepOutputStatus;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Extraction step ${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function requireRepresentationType(value: unknown): ExtractionRepresentationType {
  const representationType = requireString(value, "representationType");

  if (
    !EXTRACTION_REPRESENTATION_TYPES.includes(
      representationType as ExtractionRepresentationType,
    )
  ) {
    throw new Error(`Unsupported extraction representation type: ${representationType}`);
  }

  return representationType as ExtractionRepresentationType;
}

function optionalString(value: unknown, fieldName: string) {
  if (value === undefined || value === null) {
    return undefined;
  }

  return requireString(value, fieldName);
}

function optionalNullableString(value: unknown, fieldName: string) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return requireString(value, fieldName);
}

function optionalUICopy(value: unknown): ExtractionProfileUICopy {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isObjectRecord(value)) {
    throw new Error("Extraction step ui must be an object.");
  }

  return {
    profileLine: optionalNullableString(value.profileLine, "ui.profileLine"),
    queuedDocumentMessage: optionalString(
      value.queuedDocumentMessage,
      "ui.queuedDocumentMessage",
    ),
    retryButtonLabel: optionalString(value.retryButtonLabel, "ui.retryButtonLabel"),
    runButtonLabel: optionalString(value.runButtonLabel, "ui.runButtonLabel"),
    runningButtonLabel: optionalString(
      value.runningButtonLabel,
      "ui.runningButtonLabel",
    ),
    runningDocumentLabel: optionalString(
      value.runningDocumentLabel,
      "ui.runningDocumentLabel",
    ),
  };
}

export function normalizeExtractionStepConfig(parameters: unknown): ExtractionStepConfig {
  const rawParameters = isObjectRecord(parameters) ? parameters : {};
  const rawConfig = isObjectRecord(rawParameters.config)
    ? rawParameters.config
    : rawParameters;
  const profile = requireString(rawConfig.profile, "profile");
  const outputKey =
    rawConfig.outputKey === undefined || rawConfig.outputKey === null
      ? null
      : requireString(rawConfig.outputKey, "outputKey");

  return {
    inputStepId: requireString(rawConfig.inputStepId, "inputStepId"),
    outputKey,
    profile,
    representationType: requireRepresentationType(rawConfig.representationType),
    taskId: rawConfig.taskId === undefined || rawConfig.taskId === null
      ? profile
      : requireString(rawConfig.taskId, "taskId"),
    ui: optionalUICopy(rawConfig.ui),
  };
}
