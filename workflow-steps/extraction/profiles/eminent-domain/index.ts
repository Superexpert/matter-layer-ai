import type { ExtractionProfile } from "../../types";
import {
  buildEminentDomainUserPrompt,
  eminentDomainSystemPrompt,
} from "./prompts";
import {
  parseEminentDomainAssessmentOutput,
  type EminentDomainAssessmentItem,
} from "./schema";

const eminentDomainCaseAssessmentJsonSchema = {
  additionalProperties: false,
  properties: {
    assessments: {
      items: {
        additionalProperties: false,
        properties: {
          matterOverview: {
            additionalProperties: false,
            properties: {
              condemningAuthority: { type: "string" },
              county: { type: "string" },
              proceduralPosture: { type: "string" },
              projectName: { type: "string" },
              propertyAddress: { type: "string" },
              propertyOwner: { type: "string" },
            },
            type: "object",
          },
          missingDocuments: {
            items: { type: "string" },
            type: "array",
          },
          proceduralFlags: {
            items: {
              additionalProperties: false,
              properties: {
                explanation: { type: "string" },
                issue: { type: "string" },
                severity: {
                  enum: ["high", "medium", "low"],
                  type: "string",
                },
                sourceCitation: { type: "string" },
              },
              required: ["issue", "explanation"],
              type: "object",
            },
            type: "array",
          },
          recommendedNextActions: {
            items: { type: "string" },
            type: "array",
          },
          takingSummary: {
            additionalProperties: false,
            properties: {
              areaTaken: { type: "string" },
              estateTaken: { type: "string" },
              keyConcerns: {
                items: { type: "string" },
                type: "array",
              },
              projectPurpose: { type: "string" },
              remainderProperty: { type: "string" },
              typeOfTaking: { type: "string" },
            },
            type: "object",
          },
          timeline: {
            items: {
              additionalProperties: false,
              properties: {
                confidence: {
                  enum: ["high", "medium", "low"],
                  type: "string",
                },
                date: { type: "string" },
                event: { type: "string" },
                sourceCitation: { type: "string" },
              },
              required: ["event"],
              type: "object",
            },
            type: "array",
          },
          valuationSummary: {
            additionalProperties: false,
            properties: {
              condemnorAppraisal: { type: "string" },
              costToCure: { type: "string" },
              finalOffer: { type: "string" },
              initialOffer: { type: "string" },
              ownerAppraisal: { type: "string" },
              partTakenValue: { type: "string" },
              remainderDamages: { type: "string" },
              temporaryDamages: { type: "string" },
              valuationGaps: {
                items: { type: "string" },
                type: "array",
              },
            },
            type: "object",
          },
        },
        type: "object",
      },
      type: "array",
    },
  },
  required: ["assessments"],
  type: "object",
} satisfies Record<string, unknown>;

const eminentDomainJsonRepairInstructions = [
  "Return a JSON object with exactly this top-level shape:",
  "{\"assessments\":[{\"matterOverview\":{},\"timeline\":[{\"event\":\"event text\"}],\"takingSummary\":{},\"valuationSummary\":{},\"proceduralFlags\":[{\"issue\":\"issue\",\"explanation\":\"explanation\"}],\"missingDocuments\":[],\"recommendedNextActions\":[]}]}",
  "Omit unsupported optional fields.",
  "Every timeline item must include event.",
  "Every procedural flag must include issue and explanation.",
].join("\n");

export const eminentDomainCaseAssessmentProfile = {
  buildUserPrompt: buildEminentDomainUserPrompt,
  description:
    "Extract eminent domain case assessment facts from selected documents.",
  id: "eminent-domain-case-assessment",
  itemLabel: "assessment item",
  itemPluralLabel: "assessment items",
  jsonRepairInstructions: eminentDomainJsonRepairInstructions,
  label: "Eminent Domain Case Assessment",
  maxOutputTokens: 8000,
  parseModelOutput: (content: string, context) => {
    const parsed = parseEminentDomainAssessmentOutput(content, {
      sourceDocumentId: context.window.documentId,
      sourceFileName: context.window.fileName,
    });

    return {
      itemCountsByType: {
        eminent_domain_case_assessment: parsed.assessments.length,
      },
      items: parsed.assessments,
      warnings: parsed.warnings,
    };
  },
  postProcess: (input: {
    items: EminentDomainAssessmentItem[];
  }) => ({
    displayItems: input.items.map((item) => ({ ...item })),
    itemCount: input.items.length,
    itemCountsByType: {
      eminent_domain_case_assessment: input.items.length,
    },
    profileOutput: {
      assessments: input.items,
    },
  }),
  responseFormat: {
    name: "eminent_domain_case_assessment",
    schema: eminentDomainCaseAssessmentJsonSchema,
    type: "json_schema",
  },
  systemPrompt: eminentDomainSystemPrompt,
  taskId: "eminent-domain-case-assessment",
  ui: {
    profileLine: null,
    retryButtonLabel: "Retry analysis",
    runButtonLabel: "Analyze case documents",
    runningButtonLabel: "Analyzing...",
    runningDocumentLabel: "Analyzing",
  },
} satisfies ExtractionProfile<EminentDomainAssessmentItem>;
