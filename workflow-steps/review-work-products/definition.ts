import type { WorkflowSchema, WorkflowStepRegistration } from "@/services/workflows/types";

const emptyObjectSchema: WorkflowSchema = {
  additionalProperties: true,
  description: "No step input is required.",
  type: "object",
};

export const reviewWorkProductsParameterSchema: WorkflowSchema = {
  additionalProperties: false,
  description: "Review generated work products for the current workflow run.",
  properties: {
    inputStepId: {
      type: "string",
    },
  },
  required: ["inputStepId"],
  type: "object",
};

export const reviewWorkProductsOutputSchema: WorkflowSchema = {
  additionalProperties: false,
  description: "Completed work product review output.",
  properties: {
    reviewedArtifactIds: {
      items: {
        type: "string",
      },
      type: "array",
    },
    status: {
      enum: ["completed"],
      type: "string",
    },
  },
  required: ["status", "reviewedArtifactIds"],
  type: "object",
};

export const reviewWorkProductsStep: WorkflowStepRegistration = {
  CanvasComponent: {
    kind: "placeholder",
    label: "Review Work Products canvas",
  },
  description: "Review generated work products inline.",
  displayName: "Review Work Products",
  execute: () => {
    throw new Error("Review Work Products is handled by the interactive workflow step.");
  },
  handleChatCommand: () => {
    throw new Error("Workflow chat commands are not implemented for this step yet.");
  },
  inputSchema: emptyObjectSchema,
  outputSchema: reviewWorkProductsOutputSchema,
  parameterSchema: reviewWorkProductsParameterSchema,
  type: "reviewWorkProducts",
};
