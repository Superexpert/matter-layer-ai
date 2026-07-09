import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { OpenAIProvider } from "@/services/ai/providers/openai-provider-core";
import { extractPdfPages } from "@/services/matter-documents/pdfjs";
import { runExtractionProfile } from "../../workflow-steps/extraction/profile-runner";
import { eminentDomainCaseAssessmentProfile } from "../../workflow-steps/extraction/profiles/eminent-domain";
import { buildEminentDomainUserPrompt } from "../../workflow-steps/extraction/profiles/eminent-domain/prompts";
import { parseEminentDomainAssessmentOutput } from "../../workflow-steps/extraction/profiles/eminent-domain/schema";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function schemaTypeIncludes(schema: Record<string, unknown>, type: string) {
  return schema.type === type ||
    (Array.isArray(schema.type) && schema.type.includes(type));
}

function assertOpenAIStrictObjectSchema(schema: unknown) {
  if (!isObjectRecord(schema)) {
    return;
  }

  if (schemaTypeIncludes(schema, "object")) {
    expect(schema.additionalProperties).toBe(false);
    const properties = isObjectRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];

    expect([...required].sort()).toEqual(Object.keys(properties).sort());
  }

  if (isObjectRecord(schema.properties)) {
    for (const propertySchema of Object.values(schema.properties)) {
      assertOpenAIStrictObjectSchema(propertySchema);
    }
  }

  if (schemaTypeIncludes(schema, "array")) {
    assertOpenAIStrictObjectSchema(schema.items);
  }
}

function assessmentResponse() {
  return JSON.stringify({
    assessments: [
      {
        matterOverview: {
          condemningAuthority: "Central Texas Mobility Authority",
          county: "Travis County",
          proceduralPosture: null,
          projectName: "FM 812 Expansion",
          propertyAddress: null,
          propertyOwner: "Parcel 14 owner",
        },
        missingDocuments: [],
        proceduralFlags: [
          {
            explanation:
              "The owner reports west driveway access could be blocked during peak business hours.",
            issue: "Temporary construction access concern",
            severity: "medium",
            sourceCitation: "Owner notes",
            sourceExcerpt:
              "The owner reports west driveway access could be blocked during peak business hours.",
          },
        ],
        recommendedNextActions: ["Request the traffic-control plan backup."],
        takingSummary: {
          areaTaken: null,
          estateTaken: "temporary construction easement",
          keyConcerns: ["parking", "driveway access"],
          projectPurpose: "roadway expansion",
          remainderProperty: null,
          typeOfTaking: "partial taking",
        },
        timeline: [
          {
            confidence: "high",
            date: "2026-04-15",
            event:
              "Owner reported continued concerns about construction access near the west driveway.",
            sourceCitation: "2026-04-15 Owner Notes Access Concerns.txt",
            sourceExcerpt:
              "Owner reported continued concerns about construction access near the west driveway.",
          },
        ],
        valuationSummary: {
          condemnorAppraisal: null,
          costToCure: null,
          finalOffer: null,
          initialOffer: null,
          ownerAppraisal: null,
          partTakenValue: null,
          remainderDamages: null,
          temporaryDamages: null,
          valuationGaps: ["No backup for traffic-control impacts."],
        },
      },
    ],
  });
}

describe("Eminent Domain extraction profile", () => {
  it("uses an OpenAI strict-compatible response schema", () => {
    assertOpenAIStrictObjectSchema(
      eminentDomainCaseAssessmentProfile.responseFormat?.schema,
    );
  });

  it("builds prompts that match nullable structured output expectations", () => {
    const prompt = buildEminentDomainUserPrompt({
      documentId: "doc_txt",
      fileName: "2026-04-15 Owner Notes Access Concerns.txt",
      markdown: "Owner called about driveway access.",
      pageEnd: null,
      pageStart: null,
      windowIndex: 0,
    });

    expect(prompt).toContain("Use null for unknown optional values.");
    expect(prompt).toContain("Use null for unsupported object fields");
    expect(prompt).toContain("sourceExcerpt must be the short supporting text");
  });

  it("works with the GPT/OpenAI provider adapter structured output request", async () => {
    const capturedRequests: unknown[] = [];
    const provider = new OpenAIProvider({
      apiKey: "test-openai-api-key",
      client: {
        responses: {
          async create(request) {
            capturedRequests.push(request);

            return {
              output_text: assessmentResponse(),
            };
          },
          async *stream() {
            yield {
              type: "response.completed",
            };
          },
        },
      },
      model: "gpt-5-mini",
    });

    const result = await runExtractionProfile(eminentDomainCaseAssessmentProfile, {
      aiService: provider,
      readyDocuments: [
        {
          fileName: "2026-04-15 Owner Notes Access Concerns.txt",
          id: "doc_txt",
          markdown: await readFile(
            path.join(
              process.cwd(),
              "sample-evidence",
              "eminent-domain",
              "2026-04-15 Owner Notes Access Concerns.txt",
            ),
            "utf8",
          ),
        },
      ],
    });

    expect(result).toMatchObject({
      error: null,
      errorCode: null,
      itemCount: 1,
      model: "gpt-5-mini",
      provider: "openai",
      status: "COMPLETED",
    });
    expect(capturedRequests[0]).toMatchObject({
      model: "gpt-5-mini",
      text: {
        format: {
          name: "eminent_domain_case_assessment",
          strict: true,
          type: "json_schema",
        },
      },
    });
  });

  it("returns valid structured output for sample txt documents", async () => {
    const result = parseEminentDomainAssessmentOutput(assessmentResponse(), {
      sourceDocumentId: "doc_txt",
      sourceFileName: "2026-04-15 Owner Notes Access Concerns.txt",
    });

    expect(result.assessments).toHaveLength(1);
    expect(result.assessments[0]).toMatchObject({
      assessment: {
        timeline: [
          {
            date: "2026-04-15",
            sourceExcerpt:
              "Owner reported continued concerns about construction access near the west driveway.",
          },
        ],
      },
      sourceDocumentId: "doc_txt",
    });
  });

  it("returns valid structured output for sample PDF-derived text", async () => {
    const pdfBytes = await readFile(
      path.join(
        process.cwd(),
        "sample-evidence",
        "eminent-domain",
        "2026-04-08 Special Commissioners Hearing Notice.pdf",
      ),
    );
    const extractedPdf = await extractPdfPages(pdfBytes);
    const markdown = extractedPdf.pageTexts.join("\n\n");

    const result = await runExtractionProfile(eminentDomainCaseAssessmentProfile, {
      aiService: {
        generateText: async () => ({
          content: assessmentResponse(),
          model: "gpt-5-mini",
          provider: "openai",
        }),
      },
      readyDocuments: [
        {
          fileName: "2026-04-08 Special Commissioners Hearing Notice.pdf",
          id: "doc_pdf",
          markdown,
        },
      ],
    });

    expect(markdown.trim().length).toBeGreaterThan(0);
    expect(result).toMatchObject({
      itemCount: 1,
      status: "COMPLETED",
    });
  });

  it("treats documents with no relevant eminent-domain facts as empty successful results", async () => {
    const result = await runExtractionProfile(eminentDomainCaseAssessmentProfile, {
      aiService: {
        generateText: async () => ({
          content: JSON.stringify({
            assessments: [],
          }),
          model: "gpt-5-mini",
          provider: "openai",
        }),
      },
      readyDocuments: [
        {
          fileName: "Unrelated.txt",
          id: "doc_empty",
          markdown: "This note is about a lunch order and has no case facts.",
        },
      ],
    });

    expect(result).toMatchObject({
      error: null,
      failedWindowCount: 0,
      itemCount: 0,
      status: "COMPLETED",
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "eminent_domain_assessment.empty",
        }),
      ]),
    );
  });

  it("postprocess keeps assessment data structured without creating a case assessment artifact", () => {
    const postprocessResult = eminentDomainCaseAssessmentProfile.postProcess?.({
      items: [
        {
          assessment: {
            matterOverview: {
              condemningAuthority: "Central Texas Mobility Authority",
              propertyOwner: "Parcel 14 owner",
            },
          },
          sourceDocumentId: "doc_overview",
          sourceFileName: "Initial Offer Letter.pdf",
        },
      ],
    });

    expect(postprocessResult?.artifacts).toEqual([]);
    expect(postprocessResult?.profileOutput).toMatchObject({
      assessments: [
        expect.objectContaining({
          assessment: expect.objectContaining({
            matterOverview: expect.objectContaining({
              condemningAuthority: "Central Texas Mobility Authority",
            }),
          }),
        }),
      ],
    });
  });
});
