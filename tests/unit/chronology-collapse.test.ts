import { describe, expect, it } from "vitest";

import {
  formatSourcePages,
  generateChronologyMarkdown,
} from "../../workflow-steps/extraction/profiles/chronology/chronology-artifact";
import { collapseChronologyFacts } from "../../workflow-steps/extraction/profiles/chronology/collapse";
import type { ChronologyFact } from "../../workflow-steps/extraction/profiles/chronology/schema";

function datedFact(overrides: Partial<ChronologyFact> = {}) {
  const date = overrides.date ?? "2024-01-12";

  return {
    confidence: "high",
    date,
    dateText: overrides.dateText ?? "January 12, 2024",
    factType: "chronology_fact",
    isApproximateDate: false,
    labels: [],
    organizations: [],
    people: ["Officer Smith", "Defendant"],
    sortDate: date,
    sourceDocumentId: "doc_1",
    sourceFileName: "Police Report.pdf",
    sourcePages: [1],
    sourceQuote: "Officer Smith stopped the defendant near Congress Avenue.",
    summary: "Officer Smith stopped the defendant near Congress Avenue.",
    warnings: [],
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
  it("collapses exact duplicate dated facts and preserves multiple sources", () => {
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

  it("collapses highly similar dated facts with same date and overlapping people", () => {
    const events = collapseChronologyFacts([
      inputFact("fact_1", datedFact()),
      inputFact("fact_2", datedFact({
        sourceQuote: "Officer Smith conducted a traffic stop near Congress Avenue.",
        summary: "Officer Smith conducted a traffic stop of the defendant near Congress Avenue.",
      })),
    ]);

    expect(events).toHaveLength(1);
  });

  it("does not collapse distinct facts merely because they occur on the same day", () => {
    const events = collapseChronologyFacts([
      inputFact("fact_1", datedFact({
        summary: "Officer Smith stopped the defendant near Congress Avenue.",
      })),
      inputFact("fact_2", datedFact({
        sourceQuote: "Officer Smith arrested the defendant at the county jail.",
        summary: "Officer Smith arrested the defendant at the county jail.",
      })),
    ]);

    expect(events).toHaveLength(2);
  });

  it("handles undated facts conservatively", () => {
    const undated = datedFact({
      date: null,
      dateText: null,
      people: ["Plaintiff"],
      sortDate: null,
      sourceFileName: "Medical Records.pdf",
      sourcePages: [4],
      sourceQuote: "Prior back pain was noted.",
      summary: "Plaintiff reported prior back pain.",
    });

    const events = collapseChronologyFacts([
      inputFact("fact_1", undated),
      inputFact("fact_2", {
        ...undated,
        sourceQuote: "Old back symptoms were mentioned.",
        summary: "Plaintiff mentioned old back symptoms.",
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

  it("sorts undated facts after dated facts", () => {
    const events = collapseChronologyFacts([
      inputFact("undated", datedFact({
        date: null,
        dateText: null,
        sortDate: null,
        summary: "The defendant reported prior symptoms.",
      })),
      inputFact("dated", datedFact()),
    ]);

    expect(events.map((event) => event.sourceFactIds[0])).toEqual([
      "dated",
      "undated",
    ]);
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

