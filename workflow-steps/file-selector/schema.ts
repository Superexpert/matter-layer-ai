export type FileSelectorStepConfig = {
  acceptedMimeTypes: string[] | null;
  allowExistingMatterFiles: boolean;
  allowUpload: boolean;
  maxFiles: number | null;
  minFiles: number;
};

export type FileSelectorStepOutput = {
  selectedMatterDocumentIds: string[];
};

export const defaultFileSelectorConfig: FileSelectorStepConfig = {
  acceptedMimeTypes: null,
  allowExistingMatterFiles: true,
  allowUpload: true,
  maxFiles: null,
  minFiles: 1,
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalBoolean(value: unknown, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    throw new Error("File selector boolean config values must be booleans.");
  }

  return value;
}

function optionalNonNegativeInteger(value: unknown, fallback: number) {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error("File selector minFiles must be a non-negative integer.");
  }

  return Number(value);
}

function optionalPositiveIntegerOrNull(value: unknown, fallback: number | null) {
  if (value === undefined) {
    return fallback;
  }

  if (value === null) {
    return null;
  }

  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error("File selector maxFiles must be a positive integer or null.");
  }

  return Number(value);
}

function optionalStringArrayOrNull(value: unknown, fallback: string[] | null) {
  if (value === undefined) {
    return fallback;
  }

  if (value === null) {
    return null;
  }

  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && item.trim().length > 0)
  ) {
    throw new Error("File selector acceptedMimeTypes must be an array of strings or null.");
  }

  return value.map((item) => item.trim());
}

export function normalizeFileSelectorConfig(parameters: unknown): FileSelectorStepConfig {
  const rawParameters = isObjectRecord(parameters) ? parameters : {};
  const rawConfig = isObjectRecord(rawParameters.config)
    ? rawParameters.config
    : rawParameters;

  const config: FileSelectorStepConfig = {
    acceptedMimeTypes: optionalStringArrayOrNull(
      rawConfig.acceptedMimeTypes,
      defaultFileSelectorConfig.acceptedMimeTypes,
    ),
    allowExistingMatterFiles: optionalBoolean(
      rawConfig.allowExistingMatterFiles,
      defaultFileSelectorConfig.allowExistingMatterFiles,
    ),
    allowUpload: optionalBoolean(rawConfig.allowUpload, defaultFileSelectorConfig.allowUpload),
    maxFiles: optionalPositiveIntegerOrNull(
      rawConfig.maxFiles,
      defaultFileSelectorConfig.maxFiles,
    ),
    minFiles: optionalNonNegativeInteger(rawConfig.minFiles, defaultFileSelectorConfig.minFiles),
  };

  if (config.maxFiles !== null && config.minFiles > config.maxFiles) {
    throw new Error("File selector minFiles cannot exceed maxFiles.");
  }

  return config;
}

export function validateFileSelectorOutput(
  output: FileSelectorStepOutput,
  config: FileSelectorStepConfig,
) {
  const selectedCount = output.selectedMatterDocumentIds.length;

  if (selectedCount < config.minFiles) {
    return `Select at least ${config.minFiles} file${config.minFiles === 1 ? "" : "s"}.`;
  }

  if (config.maxFiles !== null && selectedCount > config.maxFiles) {
    return `Select no more than ${config.maxFiles} file${config.maxFiles === 1 ? "" : "s"}.`;
  }

  return "";
}
