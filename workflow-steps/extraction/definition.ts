import type { WorkflowSchema, WorkflowStepRegistration } from "@/services/workflows/types";

const emptyObjectSchema: WorkflowSchema = {
  additionalProperties: true,
  description: "No step input is required.",
  type: "object",
};

export const extractionParameterSchema: WorkflowSchema = {
  additionalProperties: false,
  description: "Document representation preparation settings.",
  properties: {
    inputStepId: {
      type: "string",
    },
    profile: {
      enum: ["chronology"],
      type: "string",
    },
    representationType: {
      enum: ["MARKDOWN"],
      type: "string",
    },
  },
  required: ["inputStepId", "profile", "representationType"],
  type: "object",
};

export const extractionOutputSchema: WorkflowSchema = {
  additionalProperties: false,
  description: "Prepared representation counts and extraction run id.",
  properties: {
    artifactReferences: {
      type: "object",
    },
    chronologyArtifactId: {
      type: ["string", "null"],
    },
    collapsedEventCount: {
      type: "integer",
    },
    collapsedEvents: {
      items: {
        type: "object",
      },
      type: "array",
    },
    documentResults: {
      items: {
        type: "object",
      },
      type: "array",
    },
    extractionRunId: {
      type: "string",
    },
    error: {
      type: ["object", "null"],
    },
    extractedFactCount: {
      type: "integer",
    },
    extractionWindowCount: {
      type: "integer",
    },
    failedRepresentationCount: {
      type: "integer",
    },
    failedDocumentIds: {
      items: {
        type: "string",
      },
      type: "array",
    },
    preparedDocumentIds: {
      items: {
        type: "string",
      },
      type: "array",
    },
    factsByType: {
      type: "object",
    },
    facts: {
      items: {
        type: "object",
      },
      type: "array",
    },
    profile: {
      type: "string",
    },
    profileOutput: {
      type: ["object", "array", "string", "number", "boolean", "null"],
    },
    progress: {
      type: ["object", "null"],
    },
    readyRepresentationCount: {
      type: "integer",
    },
    schemaVersion: {
      const: 1,
      type: "integer",
    },
    selectedMatterDocumentIds: {
      items: {
        type: "string",
      },
      type: "array",
    },
    status: {
      enum: ["completed", "failed", "partial_failed", "running"],
      type: "string",
    },
  },
  required: [
    "chronologyArtifactId",
    "artifactReferences",
    "collapsedEventCount",
    "collapsedEvents",
    "documentResults",
    "extractedFactCount",
    "extractionWindowCount",
    "extractionRunId",
    "error",
    "facts",
    "factsByType",
    "failedDocumentIds",
    "failedRepresentationCount",
    "preparedDocumentIds",
    "profile",
    "profileOutput",
    "progress",
    "readyRepresentationCount",
    "schemaVersion",
    "selectedMatterDocumentIds",
    "status",
  ],
  type: "object",
};

export const extractionStep: WorkflowStepRegistration = {
  adminSettings: [
    {
      defaultValue: null,
      description: "Use a specific AI Provider for this step, or use the app default.",
      key: "aiProviderId",
      label: "AI Provider",
      type: "aiProvider",
    },
  ],
  CanvasComponent: {
    kind: "placeholder",
    label: "Extraction canvas",
  },
  description: "Prepare selected matter documents for structured extraction.",
  displayName: "Extraction",
  execute: () => {
    throw new Error("Extraction workflow execution is handled by the interactive step.");
  },
  handleChatCommand: () => {
    throw new Error("Workflow chat commands are not implemented for this step yet.");
  },
  inputSchema: emptyObjectSchema,
  outputSchema: extractionOutputSchema,
  parameterSchema: extractionParameterSchema,
  type: "extraction",
};
