import type { BuiltInWorkflowDefinition, WorkflowDefinition } from "@/services/workflows/types";

export const chronologyDefinition: WorkflowDefinition = {
  description: "Create a chronology from selected matter documents.",
  id: "chronology",
  name: "Chronology",
  steps: [
    {
      description: "Choose the matter documents that should be used for this workflow.",
      id: "select-source-files",
      name: "Select source documents",
      parameters: {
        acceptedMimeTypes: [
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "text/plain",
        ],
        allowExistingMatterFiles: true,
        allowUpload: true,
        maxFiles: null,
        minFiles: 1,
      },
      type: "fileSelector",
    },
    {
      description: "Placeholder for chronology extraction from selected documents.",
      id: "extract-chronology-events",
      name: "Extract chronology events",
      parameters: {},
      type: "extraction",
    },
  ],
};

export const chronologyBuiltIn: BuiltInWorkflowDefinition = {
  builtInVersion: 1,
  definition: chronologyDefinition,
  isEnabledByDefault: true,
  isSystem: false,
  slug: "chronology",
};
