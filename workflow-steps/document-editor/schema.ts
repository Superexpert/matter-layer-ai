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
  documentFileName: string | null;
  documentTitle: string | null;
  editor: DocumentEditorEditor;
  generatedArtifact: {
    extractionOutputKey: string;
    extractionStepId: string;
    kind: "eminent-domain-client-summary" | "eminent-domain-lawyer-memo";
    reviewedAssessmentStepId?: string;
    reviewedLawyerMemoStepId?: string;
  } | null;
  inputStepId: string;
  saveMode: DocumentEditorSaveMode;
};

export type DocumentEditorStepOutput =
  | {
      reviewedArtifactId: string;
      revisionId: string;
      savedMatterDocumentId: string;
      sourceArtifactId: string;
      status: "completed";
    }
  | {
      artifactId: string;
      savedMatterDocumentId: string;
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
    documentFileName:
      typeof rawConfig.documentFileName === "string" && rawConfig.documentFileName.trim()
        ? rawConfig.documentFileName.trim()
        : null,
    documentTitle:
      typeof rawConfig.documentTitle === "string" && rawConfig.documentTitle.trim()
        ? rawConfig.documentTitle.trim()
        : null,
    editor: enumValue(rawConfig.editor, "editor", DOCUMENT_EDITOR_EDITORS, "tiptap"),
    generatedArtifact: normalizeGeneratedArtifact(rawConfig.generatedArtifact),
    inputStepId: requireString(rawConfig.inputStepId, "inputStepId"),
    saveMode: enumValue(
      rawConfig.saveMode,
      "saveMode",
      DOCUMENT_EDITOR_SAVE_MODES,
      "revision",
    ),
  };
}

function normalizeGeneratedArtifact(value: unknown): DocumentEditorStepConfig["generatedArtifact"] {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isObjectRecord(value)) {
    throw new Error("Document editor step generatedArtifact must be an object.");
  }

  const kind = requireString(value.kind, "generatedArtifact.kind");
  if (
    kind !== "eminent-domain-lawyer-memo" &&
    kind !== "eminent-domain-client-summary"
  ) {
    throw new Error(`Unsupported document editor generated artifact kind: ${kind}`);
  }

  return {
    extractionOutputKey: requireString(
      value.extractionOutputKey,
      "generatedArtifact.extractionOutputKey",
    ),
    extractionStepId: requireString(
      value.extractionStepId,
      "generatedArtifact.extractionStepId",
    ),
    kind,
    reviewedAssessmentStepId:
      typeof value.reviewedAssessmentStepId === "string" &&
      value.reviewedAssessmentStepId.trim()
        ? value.reviewedAssessmentStepId.trim()
        : undefined,
    reviewedLawyerMemoStepId:
      typeof value.reviewedLawyerMemoStepId === "string" &&
      value.reviewedLawyerMemoStepId.trim()
        ? value.reviewedLawyerMemoStepId.trim()
        : undefined,
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
    typeof value.revisionId === "string" &&
    typeof value.savedMatterDocumentId === "string"
  ) {
    return {
      reviewedArtifactId: value.reviewedArtifactId,
      revisionId: value.revisionId,
      savedMatterDocumentId: value.savedMatterDocumentId,
      sourceArtifactId: value.sourceArtifactId,
      status: "completed",
    };
  }

  if (
    typeof value.artifactId === "string" &&
    typeof value.savedMatterDocumentId === "string"
  ) {
    return {
      artifactId: value.artifactId,
      savedMatterDocumentId: value.savedMatterDocumentId,
      status: "completed",
    };
  }

  throw new Error("Document editor step output must include artifact and matter document ids.");
}
