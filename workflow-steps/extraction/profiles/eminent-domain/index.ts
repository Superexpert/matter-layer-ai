import type { ExtractionProfile } from "../../types";
import {
  buildEminentDomainUserPrompt,
  eminentDomainSystemPrompt,
} from "./prompts";
import {
  parseEminentDomainAssessmentOutput,
  type EminentDomainAssessmentItem,
} from "./schema";

const nullableStringSchema = {
  type: ["string", "null"],
};

const nullableStringArraySchema = {
  items: { type: "string" },
  type: ["array", "null"],
};

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
              condemningAuthority: nullableStringSchema,
              county: nullableStringSchema,
              proceduralPosture: nullableStringSchema,
              projectName: nullableStringSchema,
              propertyAddress: nullableStringSchema,
              propertyOwner: nullableStringSchema,
            },
            required: [
              "propertyOwner",
              "condemningAuthority",
              "projectName",
              "propertyAddress",
              "county",
              "proceduralPosture",
            ],
            type: ["object", "null"],
          },
          missingDocuments: nullableStringArraySchema,
          proceduralFlags: {
            items: {
              additionalProperties: false,
              properties: {
                explanation: { type: "string" },
                issue: { type: "string" },
                severity: {
                  enum: ["high", "medium", "low", null],
                  type: ["string", "null"],
                },
                sourceCitation: nullableStringSchema,
              },
              required: ["issue", "explanation", "severity", "sourceCitation"],
              type: "object",
            },
            type: ["array", "null"],
          },
          recommendedNextActions: nullableStringArraySchema,
          takingSummary: {
            additionalProperties: false,
            properties: {
              areaTaken: nullableStringSchema,
              estateTaken: nullableStringSchema,
              keyConcerns: nullableStringArraySchema,
              projectPurpose: nullableStringSchema,
              remainderProperty: nullableStringSchema,
              typeOfTaking: nullableStringSchema,
            },
            required: [
              "typeOfTaking",
              "estateTaken",
              "areaTaken",
              "remainderProperty",
              "projectPurpose",
              "keyConcerns",
            ],
            type: ["object", "null"],
          },
          timeline: {
            items: {
              additionalProperties: false,
              properties: {
                confidence: {
                  enum: ["high", "medium", "low", null],
                  type: ["string", "null"],
                },
                date: nullableStringSchema,
                event: { type: "string" },
                sourceCitation: nullableStringSchema,
              },
              required: ["date", "event", "sourceCitation", "confidence"],
              type: "object",
            },
            type: ["array", "null"],
          },
          valuationSummary: {
            additionalProperties: false,
            properties: {
              condemnorAppraisal: nullableStringSchema,
              costToCure: nullableStringSchema,
              finalOffer: nullableStringSchema,
              initialOffer: nullableStringSchema,
              ownerAppraisal: nullableStringSchema,
              partTakenValue: nullableStringSchema,
              remainderDamages: nullableStringSchema,
              temporaryDamages: nullableStringSchema,
              valuationGaps: nullableStringArraySchema,
            },
            required: [
              "initialOffer",
              "finalOffer",
              "condemnorAppraisal",
              "ownerAppraisal",
              "partTakenValue",
              "remainderDamages",
              "temporaryDamages",
              "costToCure",
              "valuationGaps",
            ],
            type: ["object", "null"],
          },
        },
        required: [
          "matterOverview",
          "timeline",
          "takingSummary",
          "valuationSummary",
          "proceduralFlags",
          "missingDocuments",
          "recommendedNextActions",
        ],
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
  "{\"assessments\":[{\"matterOverview\":{\"propertyOwner\":null,\"condemningAuthority\":null,\"projectName\":null,\"propertyAddress\":null,\"county\":null,\"proceduralPosture\":null},\"timeline\":[{\"date\":null,\"event\":\"event text\",\"sourceCitation\":null,\"confidence\":null}],\"takingSummary\":{\"typeOfTaking\":null,\"estateTaken\":null,\"areaTaken\":null,\"remainderProperty\":null,\"projectPurpose\":null,\"keyConcerns\":[]},\"valuationSummary\":{\"initialOffer\":null,\"finalOffer\":null,\"condemnorAppraisal\":null,\"ownerAppraisal\":null,\"partTakenValue\":null,\"remainderDamages\":null,\"temporaryDamages\":null,\"costToCure\":null,\"valuationGaps\":[]},\"proceduralFlags\":[{\"issue\":\"issue\",\"explanation\":\"explanation\",\"severity\":null,\"sourceCitation\":null}],\"missingDocuments\":[],\"recommendedNextActions\":[]}]}",
  "Use null for unsupported optional scalar or object fields.",
  "Use empty arrays when no items exist.",
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
    artifacts: [],
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
