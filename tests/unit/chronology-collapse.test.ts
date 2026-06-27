import { describe, expect, it } from "vitest";

import { generateChronologyMarkdown, formatSourcePages } from "../../workflow-steps/extraction/profiles/chronology/chronology-artifact";
import { collapseChronologyFacts } from "../../workflow-steps/extraction/profiles/chronology/collapse";
import type { ChronologyFact } from "../../workflow-steps/extraction/profiles/chronology/schema";

function datedFact(overrides: Partial<Extract<ChronologyFact, { factType: "dated_event" }>> = {}) {
  return {
    actors: ["Officer Smith", "Defendant"],
    confidence: "high",
    date: "2024-01-12",
    dateText: "January 12, 2024",
    eventSummary: "Officer Smith stopped the defendant near Congress Avenue.",
    factType: "dated_event",
    isApproximateDate: false,
    sourceDocumentId: "doc_1",
    sourceFileName: "Police Report.pdf",
    sourcePages: [1],
    sourceQuote: "Officer Smith stopped the defendant near Congress Avenue.",
    ...overrides,
  } satisfies ChronologyFact;
}

function inputFact(id: string, fact: ChronologyFact) {
  return {
    fact,
    id,
  };
}

describe("chronology collapse", () => {
  it("collapses exact duplicate dated events and preserves multiple sources", () => {
    const events = collapseChronologyFacts([
      inputFact("fact_1", datedFact()),
      inputFact("fact_2", datedFact({
        sourceDocumentId: "doc_2",
        sourceFileName: "Deposition.pdf",
        sourcePages: [17],
        sourceQuote: "The stop occurred near Congress Avenue.",
      })),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      date: "2024-01-12",
      sourceFactIds: ["fact_1", "fact_2"],
    });
    expect(events[0].sources).toHaveLength(2);
  });

  it("collapses highly similar dated events with same date and overlapping actors", () => {
    const events = collapseChronologyFacts([
      inputFact("fact_1", datedFact()),
      inputFact("fact_2", datedFact({
        eventSummary: "Officer Smith conducted a traffic stop of the defendant near Congress Avenue.",
        sourceQuote: "Officer Smith conducted a traffic stop near Congress Avenue.",
      })),
    ]);

    expect(events).toHaveLength(1);
  });

  it("does not collapse distinct events merely because they occur on the same day", () => {
    const events = collapseChronologyFacts([
      inputFact("fact_1", datedFact({
        eventSummary: "Officer Smith stopped the defendant near Congress Avenue.",
      })),
      inputFact("fact_2", datedFact({
        eventSummary: "Officer Smith arrested the defendant at the county jail.",
        sourceQuote: "Officer Smith arrested the defendant at the county jail.",
      })),
    ]);

    expect(events).toHaveLength(2);
  });

  it("handles undated events conservatively", () => {
    const undated = {
      actors: ["Plaintiff"],
      confidence: "medium",
      dateClues: "",
      eventSummary: "Plaintiff reported prior back pain.",
      factType: "undated_event",
      sourceDocumentId: "doc_1",
      sourceFileName: "Medical Records.pdf",
      sourcePages: [4],
      sourceQuote: "Prior back pain was noted.",
    } satisfies ChronologyFact;

    const events = collapseChronologyFacts([
      inputFact("fact_1", undated),
      inputFact("fact_2", {
        ...undated,
        eventSummary: "Plaintiff mentioned old back symptoms.",
        sourceQuote: "Old back symptoms were mentioned.",
      }),
    ]);

    expect(events).toHaveLength(2);
  });

  it("uses the lowest supporting confidence and creates sort keys", () => {
    const events = collapseChronologyFacts([
      inputFact("fact_1", datedFact({ confidence: "high" })),
      inputFact("fact_2", datedFact({ confidence: "low" })),
    ]);

    expect(events[0]).toMatchObject({
      confidence: "low",
      sortKey: "2024-01-12",
    });
  });

  it("includes meaningful document dates and omits generic document dates", () => {
    const baseDocumentDate = {
      confidence: "medium",
      date: "2024-02-03",
      dateRole: "document_date",
      dateText: "February 3, 2024",
      factType: "document_date",
      sourceDocumentId: "doc_1",
      sourceFileName: "Filing.pdf",
      sourcePages: [1],
      sourceQuote: "Dated February 3, 2024",
    } satisfies ChronologyFact;

    const events = collapseChronologyFacts([
      inputFact("generic", baseDocumentDate),
      inputFact("filing", {
        ...baseDocumentDate,
        dateRole: "filing_date",
        sourceQuote: "Filed February 3, 2024",
      }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].summary).toContain("filing date");
  });
});

describe("chronology Markdown artifact", () => {
  it("formats page references", () => {
    expect(formatSourcePages([1])).toBe("p. 1");
    expect(formatSourcePages([1, 2])).toBe("pp. 1-2");
    expect(formatSourcePages([1, 3, 5])).toBe("pp. 1, 3, 5");
  });

  it("includes every event source and omits unsourced events", () => {
    const events = collapseChronologyFacts([
      inputFact("fact_1", datedFact()),
      inputFact("fact_2", datedFact({
        sourceDocumentId: "doc_2",
        sourceFileName: "Deposition.pdf",
        sourcePages: [17],
      })),
    ]);
    const markdown = generateChronologyMarkdown([
      ...events,
      {
        ...events[0],
        sources: [],
        summary: "Unsupported unsourced event.",
      },
    ]);

    expect(markdown).toContain("# Chronology");
    expect(markdown).toContain("Police Report.pdf, p. 1");
    expect(markdown).toContain("Deposition.pdf, p. 17");
    expect(markdown).not.toContain("Unsupported unsourced event.");
  });
});
