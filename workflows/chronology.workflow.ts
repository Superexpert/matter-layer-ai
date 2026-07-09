import type { BuiltInWorkflowDefinition, WorkflowDefinition } from "@/services/workflows/types";

export const chronologyDefinition: WorkflowDefinition = {
  description: "Create a chronology from selected case files.",
  id: "chronology",
  name: "Chronology",
  steps: [
    {
      description: "Choose the case files that should be used for this workflow.",
      id: "select-source-files",
      name: "Select Case Files",
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
      autorun: true,
      description: "Extract chronology facts from the selected case files.",
      id: "extract-chronology",
      name: "Extract Facts",
      parameters: {
        inputStepId: "select-source-files",
        outputKey: "chronologyArtifactId",
        profile: "chronology",
        representationType: "MARKDOWN",
        taskId: "chronology",
        ui: {
          profileLine: null,
          runButtonLabel: "Extract chronology facts",
          runningDocumentLabel: "Extracting facts",
        },
      },
      type: "extraction",
    },
    {
      description: "Review generated work products inline.",
      id: "review-work-products",
      name: "Review Work Products",
      parameters: {
        inputStepId: "extract-chronology",
      },
      type: "reviewWorkProducts",
    },
  ],
};

export const chronologyBuiltIn: BuiltInWorkflowDefinition = {
  builtInVersion: 3,
  definition: chronologyDefinition,
  isEnabledByDefault: true,
  isSystem: false,
  slug: "chronology",
};
