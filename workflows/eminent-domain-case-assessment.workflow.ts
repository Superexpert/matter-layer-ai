import type { BuiltInWorkflowDefinition, WorkflowDefinition } from "@/services/workflows/types";

export const eminentDomainCaseAssessmentDefinition: WorkflowDefinition = {
  description:
    "Assess an eminent domain matter by starting with the relevant case documents.",
  id: "eminent-domain-case-assessment",
  name: "Eminent Domain Case Assessment",
  steps: [
    {
      description:
        "Select the offer letters, appraisal reports, petitions, maps, surveys, correspondence, and other documents related to the eminent domain matter.",
      id: "select-documents",
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
      description:
        "Extract the case timeline, taking summary, valuation facts, procedural flags, missing documents, and recommended next actions from the selected case files.",
      id: "analyze-case-documents",
      name: "Extract Facts",
      parameters: {
        inputStepId: "select-documents",
        outputKey: "eminentDomainCaseAssessment",
        profile: "eminent-domain-case-assessment",
        representationType: "MARKDOWN",
        taskId: "eminent-domain-case-assessment",
        ui: {
          profileLine: null,
          retryButtonLabel: "Retry analysis",
          runButtonLabel: "Analyze case files",
          runningButtonLabel: "Analyzing...",
          runningDocumentLabel: "Analyzing",
        },
      },
      type: "extraction",
    },
    {
      description: "Review generated work products inline.",
      id: "review-work-products",
      name: "Review Work Products",
      parameters: {
        inputStepId: "analyze-case-documents",
      },
      type: "reviewWorkProducts",
    },
  ],
};

export const eminentDomainCaseAssessmentBuiltIn: BuiltInWorkflowDefinition = {
  builtInVersion: 3,
  definition: eminentDomainCaseAssessmentDefinition,
  isEnabledByDefault: true,
  isSystem: false,
  slug: "eminent-domain-case-assessment",
};
