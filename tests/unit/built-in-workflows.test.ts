import { describe, expect, it } from "vitest";

import {
  builtInWorkflows,
  eminentDomainCaseAssessmentDefinition,
} from "../../workflows";

describe("built-in workflow registration", () => {
  it("registers Eminent Domain Case Assessment with Select Documents and generic extraction steps", () => {
    const builtInWorkflow = builtInWorkflows.find(
      (workflow) => workflow.slug === "eminent-domain-case-assessment",
    );

    expect(builtInWorkflow).toMatchObject({
      builtInVersion: 1,
      isEnabledByDefault: true,
      isSystem: false,
      slug: "eminent-domain-case-assessment",
    });
    expect(builtInWorkflow?.definition).toBe(eminentDomainCaseAssessmentDefinition);
    expect(eminentDomainCaseAssessmentDefinition).toMatchObject({
      description:
        "Assess an eminent domain matter by starting with the relevant case documents.",
      id: "eminent-domain-case-assessment",
      name: "Eminent Domain Case Assessment",
    });
    expect(eminentDomainCaseAssessmentDefinition.steps).toEqual([
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
    ]);
  });
});
