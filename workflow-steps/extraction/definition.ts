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
    extractionRunId: {
      type: "string",
    },
    failedRepresentationCount: {
      type: "integer",
    },
    profile: {
      type: "string",
    },
    readyRepresentationCount: {
      type: "integer",
    },
    selectedMatterDocumentIds: {
      items: {
        type: "string",
      },
      type: "array",
    },
    status: {
      enum: ["completed", "failed", "partial_failed"],
      type: "string",
    },
  },
  required: [
    "extractionRunId",
    "failedRepresentationCount",
    "profile",
    "readyRepresentationCount",
    "selectedMatterDocumentIds",
    "status",
  ],
  type: "object",
};

export const extractionStep: WorkflowStepRegistration = {
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
