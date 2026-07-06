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
      name: "Select Documents",
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
        "Extract the case timeline, taking summary, valuation facts, procedural flags, missing documents, and recommended next actions from the selected documents.",
      id: "analyze-case-documents",
      name: "Analyze Case Documents",
      parameters: {
        inputStepId: "select-documents",
        outputKey: "eminentDomainCaseAssessment",
        profile: "eminent-domain-case-assessment",
        representationType: "MARKDOWN",
        taskId: "eminent-domain-case-assessment",
        ui: {
          profileLine: null,
          retryButtonLabel: "Retry analysis",
          runButtonLabel: "Analyze case documents",
          runningButtonLabel: "Analyzing...",
          runningDocumentLabel: "Analyzing",
        },
      },
      type: "extraction",
    },
    {
      description:
        "Review, edit, and save the generated eminent domain case assessment.",
      id: "review-case-assessment",
      name: "Review Case Assessment",
      parameters: {
        artifactOutputKey: "eminentDomainCaseAssessmentArtifactId",
        contentType: "MARKDOWN",
        documentFileName: "Eminent Domain Case Assessment",
        documentTitle: "Eminent Domain Case Assessment",
        editor: "tiptap",
        inputStepId: "analyze-case-documents",
        saveMode: "revision",
      },
      type: "documentEditor",
    },
    {
      description:
        "Review and edit a lawyer-facing memo generated from the case assessment.",
      id: "review-lawyer-memo",
      name: "Review Lawyer Memo",
      parameters: {
        artifactOutputKey: "eminentDomainLawyerMemoArtifactId",
        contentType: "MARKDOWN",
        documentFileName: "Lawyer Memo",
        documentTitle: "Lawyer Memo",
        editor: "tiptap",
        generatedArtifact: {
          extractionOutputKey: "eminentDomainCaseAssessment",
          extractionStepId: "analyze-case-documents",
          kind: "eminent-domain-lawyer-memo",
          reviewedAssessmentStepId: "review-case-assessment",
        },
        inputStepId: "analyze-case-documents",
        saveMode: "revision",
      },
      type: "documentEditor",
    },
    {
      description:
        "Review and edit a client-facing summary generated from the case assessment.",
      id: "review-client-summary",
      name: "Review Client Summary",
      parameters: {
        artifactOutputKey: "eminentDomainClientSummaryArtifactId",
        contentType: "MARKDOWN",
        documentFileName: "Client Summary",
        documentTitle: "Client Summary",
        editor: "tiptap",
        generatedArtifact: {
          extractionOutputKey: "eminentDomainCaseAssessment",
          extractionStepId: "analyze-case-documents",
          kind: "eminent-domain-client-summary",
          reviewedAssessmentStepId: "review-case-assessment",
          reviewedLawyerMemoStepId: "review-lawyer-memo",
        },
        inputStepId: "analyze-case-documents",
        saveMode: "revision",
      },
      type: "documentEditor",
    },
  ],
};

export const eminentDomainCaseAssessmentBuiltIn: BuiltInWorkflowDefinition = {
  builtInVersion: 1,
  definition: eminentDomainCaseAssessmentDefinition,
  isEnabledByDefault: true,
  isSystem: false,
  slug: "eminent-domain-case-assessment",
};
