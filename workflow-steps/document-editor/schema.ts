export const DOCUMENT_EDITOR_CONTENT_TYPES = ["MARKDOWN"] as const;
export const DOCUMENT_EDITOR_EDITORS = ["tiptap"] as const;
export const DOCUMENT_EDITOR_SAVE_MODES = ["revision", "overwrite"] as const;

export type DocumentEditorContentType =
  (typeof DOCUMENT_EDITOR_CONTENT_TYPES)[number];
export type DocumentEditorEditor = (typeof DOCUMENT_EDITOR_EDITORS)[number];
export type DocumentEditorSaveMode =
  (typeof DOCUMENT_EDITOR_SAVE_MODES)[number];

export type DocumentEditorStepConfig = {
  artifactOutputKey: string;
  contentType: DocumentEditorContentType;
  editor: DocumentEditorEditor;
  inputStepId: string;
  saveMode: DocumentEditorSaveMode;
};

export type DocumentEditorStepOutput =
  | {
      reviewedArtifactId: string;
      revisionId: string;
      sourceArtifactId: string;
      status: "completed";
    }
  | {
      artifactId: string;
      status: "completed";
    };

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Document editor step ${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function enumValue<T extends readonly string[]>(
  value: unknown,
  fieldName: string,
  options: T,
  defaultValue: T[number],
): T[number] {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const stringValue = requireString(value, fieldName);
  if (!options.includes(stringValue)) {
    throw new Error(`Unsupported document editor ${fieldName}: ${stringValue}`);
  }

  return stringValue as T[number];
}

export function normalizeDocumentEditorStepConfig(
  parameters: unknown,
): DocumentEditorStepConfig {
  const rawParameters = isObjectRecord(parameters) ? parameters : {};
  const rawConfig = isObjectRecord(rawParameters.config)
    ? rawParameters.config
    : rawParameters;

  return {
    artifactOutputKey: requireString(rawConfig.artifactOutputKey, "artifactOutputKey"),
    contentType: enumValue(
      rawConfig.contentType,
      "contentType",
      DOCUMENT_EDITOR_CONTENT_TYPES,
      "MARKDOWN",
    ),
    editor: enumValue(rawConfig.editor, "editor", DOCUMENT_EDITOR_EDITORS, "tiptap"),
    inputStepId: requireString(rawConfig.inputStepId, "inputStepId"),
    saveMode: enumValue(
      rawConfig.saveMode,
      "saveMode",
      DOCUMENT_EDITOR_SAVE_MODES,
      "revision",
    ),
  };
}

export function assertDocumentEditorStepOutput(
  value: unknown,
): DocumentEditorStepOutput {
  if (!isObjectRecord(value) || value.status !== "completed") {
    throw new Error("Document editor step output must be completed.");
  }

  if (
    typeof value.sourceArtifactId === "string" &&
    typeof value.reviewedArtifactId === "string" &&
    typeof value.revisionId === "string"
  ) {
    return {
      reviewedArtifactId: value.reviewedArtifactId,
      revisionId: value.revisionId,
      sourceArtifactId: value.sourceArtifactId,
      status: "completed",
    };
  }

  if (typeof value.artifactId === "string") {
    return {
      artifactId: value.artifactId,
      status: "completed",
    };
  }

  throw new Error("Document editor step output must include artifact ids.");
}
