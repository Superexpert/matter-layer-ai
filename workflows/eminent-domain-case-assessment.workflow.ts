import type { BuiltInWorkflowDefinition, WorkflowDefinition } from "@/services/workflows/types";

const LAWYER_MEMO_INSTRUCTIONS = `Write a concise lawyer memo for an eminent-domain lawyer.
Use these sections: # Lawyer Memo; ## Matter Overview; ## Executive Assessment; ## Taking and Compensation; ## Material Issues; ## Material Conflicts and Uncertainties; ## Missing Evidence; ## Recommended Next Steps.
Target approximately two to four pages. State each canonical matter fact once and do not dump every fact. Focus on legally and strategically important issues and explain apparent connections among the taking, property impacts, and valuation. Treat conflicts as unresolved. Distinguish allegations, assumptions, anticipated impacts, and confirmed facts. Do not claim a document is missing merely because an earlier document did not include it. Cite every material factual statement. Avoid repetition and unrelated boilerplate.`;

const CLIENT_SUMMARY_INSTRUCTIONS = `Write a clear client-facing summary of the eminent-domain matter.
Use these sections: # Client Summary; ## What the Condemning Authority Is Taking; ## What Has Happened; ## The Offer and Appraisal; ## Why Access and Parking Matter; ## What Happens Next; ## What We Need From You.
Target approximately one to two pages and use plain language. Do not predict the outcome or promise additional compensation. Do not state allegations or assumptions as established facts. Explain material conflicts as uncertainties counsel is investigating. Focus on facts important to the property owner, omit minor procedural detail, cite important factual statements, and do not mention internal system concepts.`;

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
        "Extract raw typed facts from the selected case files.",
      id: "analyze-case-documents",
      name: "Extract Facts",
      parameters: {
        inputStepId: "select-documents",
        outputKey: "eminentDomainCaseAssessment",
        profile: "eminent-domain-facts",
        representationType: "MARKDOWN",
        taskId: "eminent-domain-facts",
        ui: {
          profileLine: null,
          retryButtonLabel: "Retry extraction",
          runButtonLabel: "Extract case facts",
          runningButtonLabel: "Extracting...",
          runningDocumentLabel: "Extracting",
        },
      },
      type: "extraction",
    },
    {
      autorun: true,
      description: "Analyze the extracted matter facts and prepare the work products.",
      id: "analyze-case",
      name: "Analyze Case",
      parameters: {
        generators: [
          { id: "lawyer-memo", instructions: LAWYER_MEMO_INSTRUCTIONS, name: "Lawyer Memo", outputName: "Lawyer Memo" },
          { id: "client-summary", instructions: CLIENT_SUMMARY_INSTRUCTIONS, name: "Client Summary", outputName: "Client Summary" },
        ],
        inputStepId: "analyze-case-documents",
      },
      type: "analyze",
    },
    {
      description: "Review generated work products inline.",
      id: "review-work-products",
      name: "Review Work Products",
      parameters: {
        inputStepId: "analyze-case",
      },
      type: "reviewWorkProducts",
    },
  ],
};

export const eminentDomainCaseAssessmentBuiltIn: BuiltInWorkflowDefinition = {
  builtInVersion: 4,
  definition: eminentDomainCaseAssessmentDefinition,
  isEnabledByDefault: true,
  isSystem: false,
  slug: "eminent-domain-case-assessment",
};
