import { describe, expect, it } from "vitest";

import { buildChronologyUserPrompt, chronologySystemPrompt } from "../../workflow-steps/extraction/profiles/chronology/prompts";
import {
  parseChronologyExtractionOutput,
  validateChronologyFact,
} from "../../workflow-steps/extraction/profiles/chronology/schema";
import { runChronologyExtraction } from "../../workflow-steps/extraction/profiles/chronology/extractor";
import { createChronologyMarkdownWindows } from "../../workflow-steps/extraction/profiles/chronology/windowing";

const validDatedEvent = {
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
  it("accept valid facts", () => {
    expect(validateChronologyFact(validDatedEvent)).toMatchObject(validDatedEvent);
  });

  it("reject invalid facts", () => {
    expect(() =>
      validateChronologyFact({
        ...validDatedEvent,
        date: "January 12",
      }),
    ).toThrow("YYYY-MM-DD");
    expect(() =>
      validateChronologyFact({
        ...validDatedEvent,
        factType: "deadline",
      }),
    ).toThrow("factType");
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
  it("includes document id, file name, page markers, and JSON-only instructions", () => {
    const prompt = buildChronologyUserPrompt({
      documentId: "doc_123",
      fileName: "Police Report.pdf",
      markdown: '<!-- ml:page {"page":1} -->\nText',
      pageEnd: 1,
      pageStart: 1,
      windowIndex: 0,
    });

    expect(chronologySystemPrompt).toContain("Return one raw JSON object only");
    expect(prompt).toContain("matterDocumentId: doc_123");
    expect(prompt).toContain("sourceFileName: Police Report.pdf");
    expect(prompt).toContain('<!-- ml:page {"page":1} -->');
    expect(prompt).toContain('"facts"');
  });

  it("parses valid JSON", () => {
    expect(
      parseChronologyExtractionOutput(JSON.stringify({
        facts: [validDatedEvent],
      })),
    ).toMatchObject({
      facts: [validDatedEvent],
    });
  });

  it("parses JSON wrapped in a Markdown code fence", () => {
    expect(
      parseChronologyExtractionOutput([
        "```json",
        JSON.stringify({
          facts: [validDatedEvent],
        }),
        "```",
      ].join("\n")),
    ).toMatchObject({
      facts: [validDatedEvent],
    });
  });

  it("normalizes common full AI date strings before validation", () => {
    expect(
      parseChronologyExtractionOutput(JSON.stringify({
        facts: [
          {
            ...validDatedEvent,
            date: "January 12, 2024",
          },
          {
            ...validDatedEvent,
            date: "1/12/2024",
            factType: "document_date",
            dateRole: "document_date",
          },
        ],
      })),
    ).toMatchObject({
      facts: [
        {
          date: "2024-01-12",
        },
        {
          date: "2024-01-12",
        },
      ],
    });
  });

  it("normalizes common AI organization type labels before validation", () => {
    expect(
      parseChronologyExtractionOutput(JSON.stringify({
        facts: [
          {
            confidence: "high",
            factType: "organization",
            name: "Austin Police Department",
            organizationType: "Police Department",
            sourceDocumentId: "doc_123",
            sourceFileName: "Police Report.pdf",
            sourcePages: [1],
            sourceQuote: "Austin Police Department incident report",
          },
        ],
      })),
    ).toMatchObject({
      facts: [
        {
          organizationType: "law_enforcement",
        },
      ],
    });
  });

  it("defaults missing AI confidence values to low", () => {
    const factWithoutConfidence: Partial<typeof validDatedEvent> = {
      ...validDatedEvent,
    };
    delete factWithoutConfidence.confidence;

    expect(
      parseChronologyExtractionOutput(JSON.stringify({
        facts: [
          factWithoutConfidence,
          {
            ...validDatedEvent,
            confidence: "",
          },
        ],
      })),
    ).toMatchObject({
      facts: [
        {
          confidence: "low",
        },
        {
          confidence: "low",
        },
      ],
    });
  });

  it("normalizes common AI source page shapes before validation", () => {
    const factWithoutSourcePages: Partial<typeof validDatedEvent> = {
      ...validDatedEvent,
    };
    delete factWithoutSourcePages.sourcePages;

    expect(
      parseChronologyExtractionOutput(JSON.stringify({
        facts: [
          factWithoutSourcePages,
          {
            ...validDatedEvent,
            sourcePages: [],
          },
          {
            ...validDatedEvent,
            sourcePages: 1,
          },
          {
            ...validDatedEvent,
            sourcePages: "2",
          },
          {
            ...validDatedEvent,
            sourcePages: "3-4",
          },
          {
            ...validDatedEvent,
            sourcePages: ["5", 6],
          },
        ],
      })),
    ).toMatchObject({
      facts: [
        {
          sourcePages: [],
        },
        {
          sourcePages: [],
        },
        {
          sourcePages: [1],
        },
        {
          sourcePages: [2],
        },
        {
          sourcePages: [3, 4],
        },
        {
          sourcePages: [5, 6],
        },
      ],
    });
  });

  it("rejects malformed JSON and facts missing source fields", () => {
    expect(() => parseChronologyExtractionOutput("{bad json")).toThrow(
      "valid JSON",
    );
    expect(() =>
      parseChronologyExtractionOutput(JSON.stringify({
        facts: [
          {
            ...validDatedEvent,
            sourceQuote: "",
          },
        ],
      })),
    ).toThrow("sourceQuote");
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
              facts: [validDatedEvent],
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
    expect(aiRequest).toMatchObject({
      maxOutputTokens: 6000,
    });
    expect(aiRequest).not.toHaveProperty("temperature");
  });
});
