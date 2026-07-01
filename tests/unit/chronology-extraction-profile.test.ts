import { describe, expect, it } from "vitest";

import {
  buildChronologyUserPrompt,
  chronologySystemPrompt,
} from "../../workflow-steps/extraction/profiles/chronology/prompts";
import {
  parseChronologyExtractionOutput,
  sortChronologyFacts,
  validateChronologyFact,
} from "../../workflow-steps/extraction/profiles/chronology/schema";
import { runChronologyExtraction } from "../../workflow-steps/extraction/profiles/chronology/extractor";
import { createChronologyMarkdownWindows } from "../../workflow-steps/extraction/profiles/chronology/windowing";

const simpleDatedFact = {
  confidence: "high",
  date: "2024-03-03",
  dateText: "March 3, 2024",
  organizations: [],
  people: ["Officer Alvarez", "John Smith"],
  sourceDocumentId: "doc_123",
  sourceFileName: "Incident Report.pdf",
  sourcePages: [1],
  sourceQuote: "On March 3, 2024, I observed the vehicle drift...",
  summary: "Officer Alvarez stopped John Smith for unsafe lane movement.",
};

const legacyDatedEvent = {
  actors: ["Officer Smith", "Defendant"],
  confidence: "high",
  date: "2024-01-12",
  dateText: "January 12, 2024",
  eventSummary: "Officer Smith stopped the defendant near Congress Avenue.",
  factType: "dated_event",
  isApproximateDate: false,
  sourceDocumentId: "doc_123",
  sourceFileName: "Police Report.pdf",
  sourcePages: [1, 2],
  sourceQuote: "On January 12, 2024, I observed...",
};

describe("chronology fact schemas", () => {
  it("accepts simple dated chronology facts", () => {
    expect(validateChronologyFact(simpleDatedFact)).toMatchObject({
      date: "2024-03-03",
      factType: "chronology_fact",
      people: ["Officer Alvarez", "John Smith"],
      sortDate: "2024-03-03",
      summary: "Officer Alvarez stopped John Smith for unsafe lane movement.",
    });
  });

  it("maps actor and eventSummary synonyms from older output", () => {
    expect(validateChronologyFact(legacyDatedEvent)).toMatchObject({
      date: "2024-01-12",
      factType: "chronology_fact",
      people: ["Officer Smith", "Defendant"],
      summary: "Officer Smith stopped the defendant near Congress Avenue.",
      warnings: expect.arrayContaining([
        expect.objectContaining({
          code: "mapped_legacy_fact_type",
        }),
      ]),
    });
  });
});

describe("chronology Markdown windowing", () => {
  it("uses the whole document when small enough", () => {
    const markdown = [
      '<!-- ml:document {"documentId":"doc_123"} -->',
      '<!-- ml:page {"page":1} -->',
      "Short page.",
      '<!-- ml:page {"page":2} -->',
      "Second page.",
    ].join("\n\n");
    const windows = createChronologyMarkdownWindows({
      documentId: "doc_123",
      fileName: "Police Report.pdf",
      markdown,
      targetWindowCharacters: 24000,
    });

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      pageEnd: 2,
      pageStart: 1,
    });
    expect(windows[0]?.markdown).toContain('<!-- ml:page {"page":1} -->');
    expect(windows[0]?.markdown).toContain('<!-- ml:page {"page":2} -->');
  });

  it("creates overlapping windows without splitting strictly page-by-page", () => {
    const page = (pageNumber: number) =>
      [`<!-- ml:page {"page":${pageNumber}} -->`, `Page ${pageNumber} ${"x".repeat(900)}`].join("\n");
    const markdown = [
      '<!-- ml:document {"documentId":"doc_123"} -->',
      page(1),
      page(2),
      page(3),
      page(4),
    ].join("\n\n");
    const windows = createChronologyMarkdownWindows({
      documentId: "doc_123",
      fileName: "Long.pdf",
      markdown,
      overlapCharacters: 120,
      targetWindowCharacters: 2100,
    });

    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0]?.markdown).toContain('<!-- ml:page {"page":1} -->');
    expect(windows[0]?.markdown).toContain('<!-- ml:page {"page":2} -->');
    expect(windows[1]?.markdown).toContain("<!-- ml:overlap -->");
    expect(windows[1]?.markdown).toContain('<!-- ml:page {"page":3} -->');
  });

  it("keeps oversized single pages instead of dropping content", () => {
    const markdown = [
      '<!-- ml:page {"page":1} -->',
      "oversized ".repeat(500),
      '<!-- ml:page {"page":2} -->',
      "tail",
    ].join("\n");
    const windows = createChronologyMarkdownWindows({
      documentId: "doc_123",
      fileName: "LongPage.pdf",
      markdown,
      targetWindowCharacters: 100,
    });

    expect(windows[0]?.markdown).toContain("oversized");
    expect(windows[0]?.pageStart).toBe(1);
  });
});

describe("chronology prompts and parser", () => {
  it("asks for sourced chronology facts, not entity taxonomy records", () => {
    const prompt = buildChronologyUserPrompt({
      documentId: "doc_123",
      fileName: "Police Report.pdf",
      markdown: '<!-- ml:page {"page":1} -->\nText',
      pageEnd: 1,
      pageStart: 1,
      windowIndex: 0,
    });

    expect(chronologySystemPrompt).toContain("chronology facts");
    expect(prompt).toContain("matterDocumentId: doc_123");
    expect(prompt).toContain("sourceFileName: Police Report.pdf");
    expect(prompt).toContain('"facts"');
    expect(prompt).toContain("Do not return standalone person");
  });

  it("parses valid JSON and Markdown code fences", () => {
    expect(
      parseChronologyExtractionOutput(JSON.stringify({
        facts: [simpleDatedFact],
      })),
    ).toMatchObject({
      facts: [
        {
          date: "2024-03-03",
          factType: "chronology_fact",
        },
      ],
    });

    expect(
      parseChronologyExtractionOutput([
        "```json",
        JSON.stringify({
          facts: [simpleDatedFact],
        }),
        "```",
      ].join("\n")),
    ).toMatchObject({
      facts: [
        {
          summary: simpleDatedFact.summary,
        },
      ],
    });
  });

  it("normalizes date, confidence, people, and source page shapes", () => {
    expect(
      parseChronologyExtractionOutput(JSON.stringify({
        facts: [
          {
            confidence: "certain",
            date: "March 4, 2024",
            dateText: "March 4, 2024",
            people: "Officer Alvarez",
            sourceDocumentId: "doc_123",
            sourceFileName: "Police Report.pdf",
            sourcePages: "3",
            sourceQuote: "I prepared this report...",
            summary: "Officer Alvarez prepared the report.",
          },
        ],
      })),
    ).toMatchObject({
      facts: [
        {
          confidence: "high",
          date: "2024-03-04",
          people: ["Officer Alvarez"],
          sourcePages: [3],
          warnings: expect.arrayContaining([
            expect.objectContaining({
              code: "coerced_people",
            }),
            expect.objectContaining({
              code: "normalized_source_pages",
            }),
          ]),
        },
      ],
    });
  });

  it("accepts Gemma-style role and dateRole values without enum failures", () => {
    const result = parseChronologyExtractionOutput(JSON.stringify({
      facts: [
        {
          actors: ["John Smith", "Officer Alvarez"],
          confidence: "strong",
          date: "2024-03-03",
          dateRole: "incident_date",
          dateText: "March 3, 2024",
          eventSummary: "John Smith was arrested after the traffic stop.",
          factType: "dated_event",
          role: "driver / arrestee",
          sourceDocumentId: "doc_123",
          sourceFileName: "Warning Citation.pdf",
          sourcePages: [2],
          sourceQuote: "Smith was placed under arrest...",
        },
      ],
    }));

    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({
      factType: "chronology_fact",
      labels: expect.arrayContaining(["driver", "arrestee", "incident_date"]),
      people: ["John Smith", "Officer Alvarez"],
      raw: expect.objectContaining({
        role: "driver / arrestee",
      }),
    });
    expect(result.warnings.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "mapped_legacy_fact_type",
        "normalized_open_role",
        "preserved_open_date_role",
      ]),
    );
  });

  it("rejects one unusable fact without failing the document when another fact is usable", () => {
    const result = parseChronologyExtractionOutput(JSON.stringify({
      facts: [
        simpleDatedFact,
        {
          date: "2024-03-03",
          summary: "The vehicle was stopped.",
        },
      ],
    }));

    expect(result.facts).toHaveLength(1);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "rejected_unusable_fact",
        }),
      ]),
    );
  });

  it("fails when all facts are unusable", () => {
    expect(() =>
      parseChronologyExtractionOutput(JSON.stringify({
        facts: [
          {
            date: "2024-03-03",
            summary: "The vehicle was stopped.",
          },
        ],
      })),
    ).toThrow("No usable chronology facts");
  });

  it("sorts dated facts ascending and places undated facts last", () => {
    const result = parseChronologyExtractionOutput(JSON.stringify({
      facts: [
        {
          ...simpleDatedFact,
          date: null,
          dateText: null,
          summary: "John Smith said he had been driving earlier.",
        },
        {
          ...simpleDatedFact,
          date: "2024-03-05",
          dateText: "March 5, 2024",
          summary: "The report was submitted.",
        },
        simpleDatedFact,
      ],
    }));

    expect(result.facts.map((fact) => fact.summary)).toEqual([
      "Officer Alvarez stopped John Smith for unsafe lane movement.",
      "The report was submitted.",
      "John Smith said he had been driving earlier.",
    ]);
    expect(sortChronologyFacts(result.facts).map((fact) => fact.summary)).toEqual(
      result.facts.map((fact) => fact.summary),
    );
  });

  it("ignores standalone person and organization records", () => {
    const result = parseChronologyExtractionOutput(JSON.stringify({
      facts: [
        {
          aliases: "Alvarez",
          factType: "person",
          name: "Officer Alvarez",
          role: "officer",
          sourceDocumentId: "doc_123",
          sourceFileName: "Police Report.pdf",
          sourcePages: [1],
          sourceQuote: "Officer Alvarez stated...",
        },
        simpleDatedFact,
      ],
    }));

    expect(result.facts).toHaveLength(1);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "rejected_unusable_fact",
          message: expect.stringContaining("Ignored standalone entity fact"),
        }),
      ]),
    );
  });
});

describe("chronology extraction runner", () => {
  it("does not send unsupported temperature parameters to the AI provider", async () => {
    let aiRequest: unknown;

    const result = await runChronologyExtraction({
      aiService: {
        generateText: async (request) => {
          aiRequest = request;
          return {
            content: JSON.stringify({
              facts: [legacyDatedEvent],
            }),
            model: "gpt-5-mini",
            provider: "openai",
          };
        },
      },
      readyDocuments: [
        {
          fileName: "Police Report.pdf",
          id: "doc_123",
          markdown: [
            '<!-- ml:document {"documentId":"doc_123"} -->',
            '<!-- ml:page {"page":1} -->',
            "On January 12, 2024, Officer Smith stopped the defendant near Congress Avenue.",
          ].join("\n\n"),
        },
      ],
    });

    expect(result.extractedFactCount).toBe(1);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({
      factType: "chronology_fact",
      summary: "Officer Smith stopped the defendant near Congress Avenue.",
    });
    expect(aiRequest).toMatchObject({
      maxOutputTokens: 6000,
      responseFormat: {
        name: "chronology_extraction",
        type: "json_schema",
      },
    });
    expect(aiRequest).not.toHaveProperty("temperature");
  });
});
