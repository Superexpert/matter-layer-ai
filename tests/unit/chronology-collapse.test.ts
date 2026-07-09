import { describe, expect, it } from "vitest";

import {
  formatSourcePages,
  generateChronologyMarkdown,
} from "../../workflow-steps/extraction/profiles/chronology/chronology-artifact";
import { collapseChronologyFacts } from "../../workflow-steps/extraction/profiles/chronology/collapse";
import type { ChronologyFact } from "../../workflow-steps/extraction/profiles/chronology/schema";
import { markdownToEditorHtml } from "../../workflow-steps/document-editor/conversion";

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

  it("groups dated events with inline citations and filters background facts", () => {
    const events = collapseChronologyFacts([
      inputFact("fact_1", datedFact({
        date: null,
        dateText: "01/14/2026|null",
        sortDate: null,
        sourceFileName: "02_Supplemental_Report_Officer_Benton.pdf",
        sourceQuote:
          "On 01/14/2026, I, Officer Tessa Benton (#6118), responded as backup to Officer Daniel Alvarez in the 1900 block of E. Riverside Dr.",
        summary:
          "Officer Tessa Benton responded as backup to Officer Daniel Alvarez at 1900 E. Riverside Dr. and observed Marcus Reed weaving over the fog line before a stop was initiated.",
      })),
      inputFact("fact_2", datedFact({
        date: null,
        dateText: "01/14/2026|null",
        sortDate: null,
        sourceDocumentId: "doc_2",
        sourceFileName: "01_Incident_Report.pdf",
        sourcePages: [3],
        sourceQuote:
          "On 01/14/2026 at approximately 2214 hours, Officer Alvarez was on routine patrol.",
        summary:
          "Officer Tessa Benton responded as backup to Officer Daniel Alvarez at 1900 E. Riverside Dr. and observed Marcus Reed weaving over the fog line before a stop was initiated.",
      })),
      inputFact("dob", datedFact({
        date: "1991-08-22",
        dateText: "August 22, 1991",
        sortDate: "1991-08-22",
        sourceFileName: "01_Incident_Report_Officer_Alvarez_V2.pdf",
        summary: "Marcus Reed's date of birth is August 22, 1991.",
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

    expect(markdown).toMatch(/^# Chronology/);
    expect(markdown).toContain("## January 14, 2026");
    expect(markdown).not.toContain("Chronology of Events");
    expect(markdown).not.toContain("Generated from selected matter documents.");
    expect(markdown).not.toContain("Undated Events");
    expect(markdown).not.toContain("**Officer Tessa Benton responded as backup");
    expect(markdown).not.toContain("Sources:");
    expect(markdown).not.toContain("* ");
    expect(markdown).not.toContain("|");
    expect(markdown).toContain(
      "Officer Tessa Benton responded as backup to Officer Daniel Alvarez at 1900 E. Riverside Dr. and observed Marcus Reed weaving over the fog line before a stop was initiated.",
    );
    expect(markdown).toContain('data-citation-source-document-id="doc_1"');
    expect(markdown).toContain('data-citation-label="Officer Benton Supplemental Report p. 1"');
    expect(markdown).toContain(
      'data-citation-cited-text="On 01/14/2026, I, Officer Tessa Benton (#6118), responded as backup to Officer Daniel Alvarez in the 1900 block of E. Riverside Dr."',
    );
    expect(markdown).toContain('data-citation-source-document-id="doc_2"');
    expect(markdown).toContain('data-citation-label="Incident Report p. 3"');
    expect(markdown).toContain(
      'data-citation-cited-text="On 01/14/2026 at approximately 2214 hours, Officer Alvarez was on routine patrol."',
    );
    expect(markdown).not.toContain("02_Supplemental_Report_Officer_Benton.pdf");
    expect(markdown).not.toContain("Marcus Reed's date of birth");
    expect(markdown).not.toContain("Unsupported unsourced event.");

    const editorHtml = markdownToEditorHtml(markdown);
    expect(editorHtml).toContain("<h1>Chronology</h1>");
    expect(editorHtml).toContain("<h2>January 14, 2026</h2>");
    expect(editorHtml).toContain("<p>Officer Tessa Benton responded");
    expect(editorHtml).toContain('data-ml-citation="true"');
    expect(editorHtml).toContain('data-citation-source-document-id="doc_2"');
    expect(editorHtml).not.toContain("<ul>");
    expect(editorHtml).not.toContain("<table>");
  });

  it("sorts dated events by date and time when available", () => {
    const markdown = generateChronologyMarkdown(collapseChronologyFacts([
      inputFact("completed", datedFact({
        date: "2026-01-15",
        dateText: "January 15, 2026",
        sortDate: "2026-01-15",
        sourceFileName: "01_Incident_Report_Officer_Alvarez_V2.pdf",
        summary: "The incident report was completed on January 15, 2026 at 12:18 AM.",
      })),
      inputFact("stop", datedFact({
        date: "2026-01-14",
        dateText: "January 14, 2026",
        sortDate: "2026-01-14",
        sourceFileName: "01_Incident_Report_Officer_Alvarez_V2.pdf",
        summary: "Officer Alvarez initiated a traffic stop of Marcus Reed's vehicle due to a lane change violation.",
      })),
      inputFact("warning", datedFact({
        date: "2026-01-14",
        dateText: "January 14, 2026",
        sortDate: "2026-01-14",
        sourceFileName: "03_Warning_Citation_Unsafe_Lane_Movement.pdf",
        summary:
          "Officer Daniel Alvarez issued a written warning to Marcus Reed for unsafe lane movement on E. Riverside Dr. at 10:27 PM on January 14, 2026.",
        timeText: "10:27 PM",
      })),
    ]));

    expect(markdown.indexOf("## January 14, 2026")).toBeLessThan(
      markdown.indexOf("## January 15, 2026"),
    );
    expect(markdown.indexOf("10:27 p.m.")).toBeLessThan(
      markdown.indexOf("traffic stop"),
    );
    expect(markdown).toContain(
      "Officer Daniel Alvarez issued a written warning to Marcus Reed for unsafe lane movement on E. Riverside Dr. at 10:27 p.m.",
    );
    expect(markdown).toContain('data-citation-label="Warning Citation Unsafe Lane Movement p. 1"');
    expect(markdown).toContain(
      "The incident report was completed at 12:18 a.m.",
    );
    expect(markdown).toContain('data-citation-label="Incident Report Officer Alvarez V2 p. 1"');
  });

  it("places undated events after dated events only when present", () => {
    const events = collapseChronologyFacts([
      inputFact("undated", datedFact({
        date: null,
        dateText: null,
        sortDate: null,
        sourceFileName: "medical-records.pdf",
        summary: "Plaintiff reported prior back pain.",
      })),
      inputFact("dated", datedFact()),
    ]);
    const markdown = generateChronologyMarkdown(events);

    expect(markdown.indexOf("## January 12, 2024")).toBeLessThan(
      markdown.indexOf("## Undated Events"),
    );
    expect(markdown).toContain('data-citation-label="Medical Records p. 1"');
  });
});
