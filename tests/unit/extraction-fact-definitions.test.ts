import { describe, expect, it } from "vitest";

import { createFactExtractionProfile } from "../../workflow-steps/extraction/generic-fact-profile";
import {
  parseIsoDatePrefixFromFileName,
  resolveExtractionDocumentMetadata,
} from "../../workflow-steps/extraction/document-metadata";
import { buildFactExtractionResponseSchema } from "../../workflow-steps/extraction/fact-schema-builder";
import { createMarkdownWindows } from "../../workflow-steps/extraction/markdown-windowing";
import { runExtractionProfile } from "../../workflow-steps/extraction/profile-runner";
import { chronologyRunnerProfile } from "../../workflow-steps/extraction/profiles/chronology/extractor";
import {
  eminentDomainFactsProfile,
  eminentDomainFactDefs,
} from "../../workflow-steps/extraction/profiles/eminent-domain";
import type { FactDef } from "../../workflow-steps/extraction/fact-def";

const testFactDefs = [
  {
    extraction: {
      fields: [
        { name: "name", required: true, type: "string" },
      ],
      instructions: "Only emit stated owners.",
    },
    factType: "PROPERTY_OWNER",
  },
  {
    extraction: {
      fields: [
        {
          enumValues: ["initial", "final", "other"],
          name: "offerType",
          required: true,
          type: "enum",
        },
        { name: "amount", required: true, type: "string" },
        { name: "parcelNumber", required: false, type: "string" },
      ],
      instructions: "Extract offers.",
    },
    factType: "OFFER",
  },
] satisfies FactDef[];

function response(facts: unknown[]) {
  return JSON.stringify({ facts });
}

function factProfile(createWindows?: ReturnType<typeof createFactExtractionProfile>["createWindows"]) {
  return createFactExtractionProfile({
    createWindows,
    factDefs: testFactDefs,
    id: "test-facts",
    label: "Test Facts",
  });
}

describe("declarative extraction fact definitions", () => {
  it("resolves reliable document dates from metadata and conservative filename prefixes", () => {
    expect(parseIsoDatePrefixFromFileName("2026-04-15 Owner Notes.txt")).toBe(
      "2026-04-15",
    );
    expect(parseIsoDatePrefixFromFileName("2026-02-30 Bad Date.txt")).toBeUndefined();
    expect(parseIsoDatePrefixFromFileName("04-05-26 Owner Notes.txt")).toBeUndefined();
    expect(parseIsoDatePrefixFromFileName("2026-04-15.txt")).toBeUndefined();

    expect(resolveExtractionDocumentMetadata({
      documentId: "doc_1",
      documentName: "2026-04-15 Owner Notes.txt",
      storedMetadata: {
        documentDate: "2026-04-14",
      },
    })).toMatchObject({
      documentDate: "2026-04-14",
      documentDateSource: "stored-metadata",
    });

    expect(resolveExtractionDocumentMetadata({
      documentId: "doc_1",
      documentName: "2026-04-15 Owner Notes.txt",
      emailMetadata: {
        sentAt: "2026-04-13T09:30:00.000Z",
      },
    })).toMatchObject({
      documentDate: "2026-04-13",
      documentDateSource: "email-metadata",
    });

    expect(resolveExtractionDocumentMetadata({
      documentId: "doc_1",
      documentName: "2026-04-15 Owner Notes.txt",
      representationMetadata: {
        documentDate: "2026-04-12",
      },
    })).toMatchObject({
      documentDate: "2026-04-15",
      documentDateSource: "filename",
    });

    expect(resolveExtractionDocumentMetadata({
      documentId: "doc_1",
      documentName: "Owner Notes.txt",
      representationMetadata: {
        documentDate: "2026-04-12",
      },
    })).toMatchObject({
      documentDate: "2026-04-12",
      documentDateSource: "document-content",
    });

    expect(resolveExtractionDocumentMetadata({
      documentId: "doc_1",
      documentName: "Owner Notes.txt",
      representationMetadata: {
        createdAt: "2026-04-11T09:30:00.000Z",
      },
    }).documentDate).toBeUndefined();
  });

  it("includes document metadata once in the generic extraction prompt", () => {
    const profile = factProfile();
    const prompt = profile.buildUserPrompt({
      documentId: "doc_notes",
      documentMetadata: resolveExtractionDocumentMetadata({
        documentId: "doc_notes",
        documentName: "2026-04-15 Owner Notes Access Concerns.txt",
        mimeType: "text/plain",
      }),
      fileName: "2026-04-15 Owner Notes Access Concerns.txt",
      markdown: "Owner called.",
      pageEnd: null,
      pageStart: null,
      windowIndex: 0,
    });

    expect(prompt).toContain("Document metadata:");
    expect(prompt).toContain("- Document date: 2026-04-15");
    expect(prompt).toContain("- Document date source: filename");
    expect(prompt.match(/Document metadata:/g)).toHaveLength(1);
    expect(prompt.match(/Metadata usage rules:/g)).toHaveLength(1);
  });

  it("builds a generic response schema from fact definitions", () => {
    const schema = buildFactExtractionResponseSchema(testFactDefs);

    expect(schema).toMatchObject({
      additionalProperties: false,
      properties: {
        facts: {
          items: {
            anyOf: expect.any(Array),
          },
        },
      },
      required: ["facts"],
      type: "object",
    });
    expect(JSON.stringify(schema)).toContain("PROPERTY_OWNER");
    expect(JSON.stringify(schema)).toContain("OFFER");
    expect(JSON.stringify(schema)).toContain("initial");
  });

  it("rejects unknown fact types", async () => {
    const result = await runExtractionProfile(factProfile(), {
      aiService: {
        generateText: async () => ({
          content: response([
            {
              factType: "UNKNOWN_FACT",
              fields: {},
              sourceExcerpt: "Unsupported.",
            },
          ]),
          model: "test",
          provider: "test",
        }),
      },
      readyDocuments: [
        { fileName: "doc.txt", id: "doc_1", markdown: "Unsupported." },
      ],
    });

    expect(result).toMatchObject({
      errorCode: "EXTRACTION_SCHEMA_VALIDATION_FAILED",
      status: "FAILED",
    });
    expect(result.error).toContain("Unsupported fact type");
  });

  it("rejects missing required fields and invalid enum values", async () => {
    const missingRequired = await runExtractionProfile(factProfile(), {
      aiService: {
        generateText: async () => ({
          content: response([
            {
              factType: "OFFER",
              fields: { offerType: "initial" },
              sourceExcerpt: "Initial offer.",
            },
          ]),
          model: "test",
          provider: "test",
        }),
      },
      readyDocuments: [
        { fileName: "offer.txt", id: "doc_offer", markdown: "Initial offer." },
      ],
    });

    expect(missingRequired.error).toContain("amount");

    const invalidEnum = await runExtractionProfile(factProfile(), {
      aiService: {
        generateText: async () => ({
          content: response([
            {
              factType: "OFFER",
              fields: { amount: "$1", offerType: "preliminary" },
              sourceExcerpt: "Preliminary offer.",
            },
          ]),
          model: "test",
          provider: "test",
        }),
      },
      readyDocuments: [
        { fileName: "offer.txt", id: "doc_offer", markdown: "Preliminary offer." },
      ],
    });

    expect(invalidEnum.error).toContain("offerType");
  });

  it("accepts optional fields and attaches document/page/excerpt provenance", async () => {
    const result = await runExtractionProfile(factProfile(), {
      aiService: {
        generateText: async () => ({
          content: response([
            {
              extractionConfidence: "high",
              factType: "OFFER",
              fields: { amount: "$125,000", offerType: "final" },
              pageEnd: 2,
              pageStart: 1,
              sourceExcerpt: "Final offer of $125,000.",
            },
          ]),
          model: "test",
          provider: "test",
        }),
      },
      readyDocuments: [
        {
          fileName: "2026-02-20 final-offer.pdf",
          id: "doc_offer",
          markdown: "<!-- ml:page {\"page\":1} -->\nFinal offer of $125,000.",
          metadata: resolveExtractionDocumentMetadata({
            documentId: "doc_offer",
            documentName: "2026-02-20 final-offer.pdf",
            mimeType: "application/pdf",
          }),
        },
      ],
    });

    expect(result).toMatchObject({
      itemCount: 1,
      status: "COMPLETED",
    });
    expect(result.items[0]).toMatchObject({
      evidence: {
        documentId: "doc_offer",
        documentName: "2026-02-20 final-offer.pdf",
        documentDate: "2026-02-20",
        documentDateSource: "filename",
        excerpt: "Final offer of $125,000.",
        pageEnd: 1,
        pageStart: 1,
      },
      factType: "OFFER",
      fields: {
        amount: "$125,000",
        offerType: "final",
      },
      extractionConfidence: "high",
    });
  });

  it("retains PDF page-marker metadata in markdown windows", () => {
    const windows = createMarkdownWindows({
      documentId: "doc_pdf",
      fileName: "sample.pdf",
      markdown: [
        "<!-- ml:page {\"page\":1} -->",
        "Page one text.",
        "<!-- ml:page {\"page\":2} -->",
        "Page two text.",
      ].join("\n"),
    });

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      pageEnd: 2,
      pageStart: 1,
    });
    expect(windows[0]?.pageSegments).toEqual([
      expect.objectContaining({ page: 1 }),
      expect.objectContaining({ page: 2 }),
    ]);
  });

  it("resolves fact provenance to the exact PDF page from source excerpts", async () => {
    const markdown = [
      "<!-- ml:page {\"page\":1} -->",
      "The owner is Jane Owner.",
      "<!-- ml:page {\"page\":2} -->",
      "Other parcel text.",
      "<!-- ml:page {\"page\":3} -->",
      "The final offer is $125,000.",
    ].join("\n");

    const result = await runExtractionProfile(factProfile(), {
      aiService: {
        generateText: async () => ({
          content: response([
            {
              factType: "PROPERTY_OWNER",
              fields: { name: "Jane Owner" },
              sourceExcerpt: "The owner is Jane Owner.",
            },
            {
              factType: "OFFER",
              fields: { amount: "$125,000", offerType: "final" },
              sourceExcerpt: "The final offer is $125,000.",
            },
          ]),
          model: "test",
          provider: "test",
        }),
      },
      readyDocuments: [
        { fileName: "sample.pdf", id: "doc_pdf", markdown },
      ],
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.evidence).toMatchObject({
      pageEnd: 1,
      pageStart: 1,
    });
    expect(result.items[1]?.evidence).toMatchObject({
      pageEnd: 3,
      pageStart: 3,
    });
  });

  it("resolves excerpts spanning PDF page markers and normalizes whitespace", async () => {
    const markdown = [
      "<!-- ml:page {\"page\":1} -->",
      "The owner is",
      "Jane",
      "<!-- ml:page {\"page\":2} -->",
      "Owner.",
    ].join("\n");

    const result = await runExtractionProfile(factProfile(), {
      aiService: {
        generateText: async () => ({
          content: response([
            {
              factType: "PROPERTY_OWNER",
              fields: { name: "Jane Owner" },
              sourceExcerpt: "The owner is Jane Owner.",
            },
          ]),
          model: "test",
          provider: "test",
        }),
      },
      readyDocuments: [
        { fileName: "sample.pdf", id: "doc_pdf", markdown },
      ],
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.items[0]?.evidence).toMatchObject({
      pageEnd: 2,
      pageStart: 1,
    });
  });

  it("falls back to the PDF window page range when excerpt matching fails", async () => {
    const result = await runExtractionProfile(factProfile(), {
      aiService: {
        generateText: async () => ({
          content: response([
            {
              factType: "PROPERTY_OWNER",
              fields: { name: "Jane Owner" },
              sourceExcerpt: "Jane Owner appears in a scanned caption.",
            },
          ]),
          model: "test",
          provider: "test",
        }),
      },
      readyDocuments: [
        {
          fileName: "sample.pdf",
          id: "doc_pdf",
          markdown: [
            "<!-- ml:page {\"page\":1} -->",
            "First page.",
            "<!-- ml:page {\"page\":2} -->",
            "Second page.",
          ].join("\n"),
        },
      ],
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.items[0]?.evidence).toMatchObject({
      pageEnd: 2,
      pageStart: 1,
    });
  });

  it("does not invent page values for text documents without page markers", async () => {
    const result = await runExtractionProfile(factProfile(), {
      aiService: {
        generateText: async () => ({
          content: response([
            {
              factType: "PROPERTY_OWNER",
              fields: { name: "Jane Owner" },
              sourceExcerpt: "Jane Owner",
            },
          ]),
          model: "test",
          provider: "test",
        }),
      },
      readyDocuments: [
        { fileName: "sample.txt", id: "doc_txt", markdown: "Jane Owner" },
      ],
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.items[0]?.evidence.pageStart).toBeUndefined();
    expect(result.items[0]?.evidence.pageEnd).toBeUndefined();
  });

  it("rejects placeholder owner values", async () => {
    const result = await runExtractionProfile(factProfile(), {
      aiService: {
        generateText: async () => ({
          content: response([
            {
              factType: "PROPERTY_OWNER",
              fields: { name: "Owner not named" },
              sourceExcerpt: "Owner not named.",
            },
          ]),
          model: "test",
          provider: "test",
        }),
      },
      readyDocuments: [
        { fileName: "owner.txt", id: "doc_owner", markdown: "Owner not named." },
      ],
    });

    expect(result).toMatchObject({
      errorCode: "EXTRACTION_SCHEMA_VALIDATION_FAILED",
      status: "FAILED",
    });
    expect(result.error).toContain("placeholder");
  });

  it("combines multiple facts from one window and multiple windows for one document", async () => {
    let callCount = 0;
    const result = await runExtractionProfile(
      factProfile((document) => [
        {
          documentId: document.documentId,
          fileName: document.fileName,
          markdown: "window one",
          pageEnd: 1,
          pageStart: 1,
          windowIndex: 0,
        },
        {
          documentId: document.documentId,
          fileName: document.fileName,
          markdown: "window two",
          pageEnd: 2,
          pageStart: 2,
          windowIndex: 1,
        },
      ]),
      {
        aiService: {
          generateText: async () => {
            callCount += 1;

            return {
              content: callCount === 1
                ? response([
                    {
                      factType: "PROPERTY_OWNER",
                      fields: { name: "Jane Owner" },
                      sourceExcerpt: "Jane Owner",
                    },
                    {
                      factType: "OFFER",
                      fields: { amount: "$100", offerType: "initial" },
                      sourceExcerpt: "$100 initial offer",
                    },
                  ])
                : response([
                    {
                      factType: "OFFER",
                      fields: { amount: "$125", offerType: "final" },
                      sourceExcerpt: "$125 final offer",
                    },
                  ]),
              model: "test",
              provider: "test",
            };
          },
        },
        readyDocuments: [
          { fileName: "combined.txt", id: "doc_combined", markdown: "both windows" },
        ],
      },
    );

    expect(result).toMatchObject({
      itemCount: 3,
      itemCountsByType: {
        OFFER: 2,
        PROPERTY_OWNER: 1,
      },
      status: "COMPLETED",
      windowCount: 2,
    });
  });

  it("keeps raw facts from multiple documents separate and does not collapse them", async () => {
    const result = await runExtractionProfile(factProfile(), {
      aiService: {
        generateText: async (request) => {
          const prompt = request.messages.at(-1)?.content ?? "";
          expect(prompt).toMatch(/doc_[ab]/);

          return {
            content: response([
              {
                factType: "PROPERTY_OWNER",
                fields: { name: "Jane Owner" },
                sourceExcerpt: "Jane Owner",
              },
            ]),
            model: "test",
            provider: "test",
          };
        },
      },
      readyDocuments: [
        { fileName: "a.txt", id: "doc_a", markdown: "Jane Owner" },
        { fileName: "b.txt", id: "doc_b", markdown: "Jane Owner" },
      ],
    });

    expect(result.items).toHaveLength(2);
    expect(result.items.map((fact) => fact.evidence.documentId).sort()).toEqual([
      "doc_a",
      "doc_b",
    ]);
    expect(new Set(result.items.map((fact) => fact.id)).size).toBe(2);
  });

  it("migrates chronology and eminent-domain profiles to declarative fact definitions", () => {
    expect(chronologyRunnerProfile.factDefs).toEqual([
      expect.objectContaining({
        factType: "DATED_EVENT",
      }),
    ]);
    expect(eminentDomainFactsProfile.factDefs.map((factDef) => factDef.factType))
      .toEqual([
        "MATTER_ENTITY",
        "PROPERTY_INTEREST",
        "VALUATION",
        "EVENT",
        "PROPERTY_IMPACT",
      ]);
    expect(JSON.stringify(eminentDomainFactsProfile.responseFormat?.schema))
      .not.toContain("matterOverview");
    expect(JSON.stringify(eminentDomainFactsProfile.responseFormat?.schema))
      .not.toContain("missingDocuments");
    expect(JSON.stringify(eminentDomainFactDefs)).not.toContain("recommendedNextActions");
  });
});
