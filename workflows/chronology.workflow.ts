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
      autorun: true,
      description: "Convert the selected documents into AI-readable Markdown for chronology extraction.",
      id: "extract-chronology",
      name: "Prepare source documents",
      parameters: {
        inputStepId: "select-source-files",
        profile: "chronology",
        representationType: "MARKDOWN",
      },
      type: "extraction",
    },
    {
      description: "Review and edit the generated chronology.",
      id: "review-chronology",
      name: "Review chronology",
      parameters: {
        artifactOutputKey: "chronologyArtifactId",
        contentType: "MARKDOWN",
        editor: "tiptap",
        inputStepId: "extract-chronology",
        saveMode: "revision",
      },
      type: "documentEditor",
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
