import type { WorkflowSchema, WorkflowStepRegistration } from "@/services/workflows/types";

const emptyObjectSchema: WorkflowSchema = {
  additionalProperties: true,
  description: "No step input is required.",
  type: "object",
};

export const documentEditorParameterSchema: WorkflowSchema = {
  additionalProperties: false,
  description: "Document artifact editor settings.",
  properties: {
    artifactOutputKey: {
      type: "string",
    },
    contentType: {
      enum: ["MARKDOWN"],
      type: "string",
    },
    documentFileName: {
      type: "string",
    },
    documentTitle: {
      type: "string",
    },
    editor: {
      enum: ["tiptap"],
      type: "string",
    },
    inputStepId: {
      type: "string",
    },
    saveMode: {
      enum: ["revision", "overwrite"],
      type: "string",
    },
  },
  required: ["inputStepId", "artifactOutputKey"],
  type: "object",
};

export const documentEditorOutputSchema: WorkflowSchema = {
  additionalProperties: false,
  description: "Reviewed artifact revision output.",
  properties: {
    artifactId: {
      type: "string",
    },
    reviewedArtifactId: {
      type: "string",
    },
    revisionId: {
      type: "string",
    },
    savedMatterDocumentId: {
      type: "string",
    },
    sourceArtifactId: {
      type: "string",
    },
    status: {
      enum: ["completed"],
      type: "string",
    },
  },
  required: ["status", "savedMatterDocumentId"],
  type: "object",
};

export const documentEditorStep: WorkflowStepRegistration = {
  CanvasComponent: {
    kind: "placeholder",
    label: "Document Editor canvas",
  },
  description: "Review and edit a workflow artifact.",
  displayName: "Document Editor",
  execute: () => {
    throw new Error("Document editor workflow execution is handled by the interactive step.");
  },
  handleChatCommand: () => {
    throw new Error("Workflow chat commands are not implemented for this step yet.");
  },
  inputSchema: emptyObjectSchema,
  outputSchema: documentEditorOutputSchema,
  parameterSchema: documentEditorParameterSchema,
  type: "documentEditor",
};
