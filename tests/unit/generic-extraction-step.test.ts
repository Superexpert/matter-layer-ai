import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { extractionStep } from "../../workflow-steps/extraction/definition";
import { getExtractionProfile } from "../../workflow-steps/extraction/profiles";
import { parseEminentDomainAssessmentOutput } from "../../workflow-steps/extraction/profiles/eminent-domain/schema";
import { normalizeExtractionStepConfig } from "../../workflow-steps/extraction/schema";

const rootDir = process.cwd();

describe("generic extraction step configuration", () => {
  it("accepts different profile ids, task ids, output keys, and UI copy", () => {
    expect(
      normalizeExtractionStepConfig({
        inputStepId: "select-documents",
        outputKey: "eminentDomainCaseAssessment",
        profile: "eminent-domain-case-assessment",
        representationType: "MARKDOWN",
        taskId: "eminent-domain-case-assessment",
        ui: {
          profileLine: null,
          runButtonLabel: "Analyze case documents",
        },
      }),
    ).toEqual({
      inputStepId: "select-documents",
      outputKey: "eminentDomainCaseAssessment",
      profile: "eminent-domain-case-assessment",
      representationType: "MARKDOWN",
      taskId: "eminent-domain-case-assessment",
      ui: {
        profileLine: null,
        queuedDocumentMessage: undefined,
        retryButtonLabel: undefined,
        runButtonLabel: "Analyze case documents",
        runningButtonLabel: undefined,
        runningDocumentLabel: undefined,
      },
    });
  });

  it("does not restrict extraction parameters to chronology", () => {
    expect(extractionStep.parameterSchema.properties?.profile).toEqual({
      type: "string",
    });
    expect(extractionStep.parameterSchema.properties?.outputKey).toEqual({
      type: ["string", "null"],
    });
    expect(extractionStep.outputSchema.additionalProperties).toBe(true);
  });

  it("registers chronology and eminent-domain extraction profiles through the same registry", () => {
    expect(getExtractionProfile("chronology")).toMatchObject({
      id: "chronology",
      label: "Chronology",
    });
    expect(getExtractionProfile("eminent-domain-case-assessment")).toMatchObject({
      id: "eminent-domain-case-assessment",
      label: "Eminent Domain Case Assessment",
      taskId: "eminent-domain-case-assessment",
    });
  });

  it("validates the eminent domain assessment schema scaffold", () => {
    const parsed = parseEminentDomainAssessmentOutput(
      JSON.stringify({
        assessments: [
          {
            matterOverview: {
              condemningAuthority: "City of Austin",
              propertyOwner: "Jane Owner",
            },
            proceduralFlags: [
              {
                explanation: "Petition date is missing from the selected documents.",
                issue: "Unable to verify filing deadline.",
                severity: "medium",
              },
            ],
            timeline: [
              {
                confidence: "high",
                date: "2026-01-15",
                event: "Initial offer letter sent.",
                sourceCitation: "Offer Letter, p. 1",
              },
            ],
          },
        ],
      }),
      {
        sourceDocumentId: "doc_ed",
        sourceFileName: "offer-letter.pdf",
      },
    );

    expect(parsed.assessments).toEqual([
      {
        assessment: expect.objectContaining({
          matterOverview: expect.objectContaining({
            condemningAuthority: "City of Austin",
            propertyOwner: "Jane Owner",
          }),
        }),
        sourceDocumentId: "doc_ed",
        sourceFileName: "offer-letter.pdf",
      },
    ]);
  });

  it("keeps chronology strings out of generic extraction UI and runtime files", () => {
    const genericFiles = [
      "workflow-steps/extraction/component.tsx",
      "workflow-steps/extraction/definition.ts",
      "workflow-steps/extraction/display-copy.ts",
      "workflow-steps/extraction/errors.ts",
      "workflow-steps/extraction/profile-runner.ts",
      "workflow-steps/extraction/schema.ts",
      "workflow-steps/extraction/types.ts",
      "services/workflow-steps/extraction-step-service.ts",
    ];

    for (const file of genericFiles) {
      const source = readFileSync(path.join(rootDir, file), "utf8");

      expect(source, file).not.toMatch(/chronology/i);
    }
  });
});
