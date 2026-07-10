import { describe, expect, it } from "vitest";

import {
  builtInWorkflows,
  eminentDomainCaseAssessmentDefinition,
} from "../../workflows";

describe("built-in workflow registration", () => {
  it("registers Eminent Domain Case Assessment with a generic Review Work Products step", () => {
    const builtInWorkflow = builtInWorkflows.find(
      (workflow) => workflow.slug === "eminent-domain-case-assessment",
    );

    expect(builtInWorkflow).toMatchObject({
      builtInVersion: 4,
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
    expect(eminentDomainCaseAssessmentDefinition.steps.map((step) => step.name)).toEqual([
      "Select Case Files",
      "Extract Facts",
      "Analyze Case",
      "Review Work Products",
    ]);
    expect(eminentDomainCaseAssessmentDefinition.steps[2]).toMatchObject({
      autorun: true,
      id: "analyze-case",
      parameters: { inputStepId: "analyze-case-documents" },
      type: "analyze",
    });
    expect(eminentDomainCaseAssessmentDefinition.steps[3]?.parameters).toEqual({
      inputStepId: "analyze-case",
    });
  });
});
