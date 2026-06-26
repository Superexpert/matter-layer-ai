import type { WorkflowSchema, WorkflowStepRegistration } from "@/services/workflows/types";

const emptyObjectSchema: WorkflowSchema = {
  additionalProperties: true,
  description: "No step input is required.",
  type: "object",
};

export const fileSelectorParameterSchema: WorkflowSchema = {
  additionalProperties: false,
  description: "Matter document selection settings.",
  properties: {
    acceptedMimeTypes: {
      items: {
        type: "string",
      },
      type: ["array", "null"],
    },
    allowExistingMatterFiles: {
      type: "boolean",
    },
    allowUpload: {
      type: "boolean",
    },
    maxFiles: {
      type: ["integer", "null"],
    },
    minFiles: {
      type: "integer",
    },
  },
  required: ["allowExistingMatterFiles", "allowUpload", "minFiles", "maxFiles"],
  type: "object",
};

export const fileSelectorOutputSchema: WorkflowSchema = {
  additionalProperties: false,
  description: "Selected matter document ids for later workflow steps.",
  properties: {
    selectedMatterDocumentIds: {
      items: {
        type: "string",
      },
      type: "array",
    },
  },
  required: ["selectedMatterDocumentIds"],
  type: "object",
};

export const fileSelectorStep: WorkflowStepRegistration = {
  CanvasComponent: {
    kind: "placeholder",
    label: "File Selector canvas",
  },
  description: "Let the user choose matter files for the workflow.",
  displayName: "File Selector",
  execute: () => {
    throw new Error("File selector workflow execution is handled by the interactive step.");
  },
  handleChatCommand: () => {
    throw new Error("Workflow chat commands are not implemented for this step yet.");
  },
  inputSchema: emptyObjectSchema,
  outputSchema: fileSelectorOutputSchema,
  parameterSchema: fileSelectorParameterSchema,
  type: "fileSelector",
};
