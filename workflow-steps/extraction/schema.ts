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
  | "partial_failed";

export type ExtractionStepOutput = {
  extractionRunId: string;
  failedRepresentationCount: number;
  profile: ExtractionProfile;
  readyRepresentationCount: number;
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
