import type { WorkflowStepError } from "@/services/workflows/workflow-step-errors";
import type { WorkflowStepProgress } from "@/services/workflows/workflow-step-progress";
import type { ExtractionWarning } from "./types";

export const EXTRACTION_REPRESENTATION_TYPES = ["MARKDOWN"] as const;
export const EXTRACTION_PROFILES = ["chronology"] as const;

export type ExtractionRepresentationType =
  (typeof EXTRACTION_REPRESENTATION_TYPES)[number];
export type ExtractionProfile = (typeof EXTRACTION_PROFILES)[number];

export type ExtractionStepConfig = {
  inputStepId: string;
  profile: ExtractionProfile;
  representationType: ExtractionRepresentationType;
};

export type ExtractionStepOutputStatus =
  | "completed"
  | "failed"
  | "partial_failed"
  | "running";

export type ExtractionStepOutput = {
  artifactReferences: Record<string, string | null>;
  chronologyArtifactId: string | null;
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
  profile: ExtractionProfile;
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

function requireProfile(value: unknown): ExtractionProfile {
  const profile = requireString(value, "profile");

  if (!EXTRACTION_PROFILES.includes(profile as ExtractionProfile)) {
    throw new Error(`Unsupported extraction profile: ${profile}`);
  }

  return profile as ExtractionProfile;
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

export function normalizeExtractionStepConfig(parameters: unknown): ExtractionStepConfig {
  const rawParameters = isObjectRecord(parameters) ? parameters : {};
  const rawConfig = isObjectRecord(rawParameters.config)
    ? rawParameters.config
    : rawParameters;

  return {
    inputStepId: requireString(rawConfig.inputStepId, "inputStepId"),
    profile: requireProfile(rawConfig.profile),
    representationType: requireRepresentationType(rawConfig.representationType),
  };
}
