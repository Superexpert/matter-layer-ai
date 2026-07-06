import { describe, expect, it } from "vitest";

import {
  LAWYER_MEMO_NO_INFORMATION,
  composeEminentDomainLawyerMemo,
} from "../../workflow-steps/extraction/profiles/eminent-domain/lawyer-memo-document";
import type { EminentDomainAssessmentItem } from "../../workflow-steps/extraction/profiles/eminent-domain/schema";

const assessmentItem: EminentDomainAssessmentItem = {
  assessment: {
    matterOverview: {
      condemningAuthority: "Central Texas Mobility Authority",
      county: "Travis County",
      projectName: "FM 812 Expansion",
      propertyOwner: "Parcel 14 owner",
    },
    missingDocuments: ["Owner appraisal has not been provided."],
    proceduralFlags: [
      {
        explanation:
          "The notice sets a special commissioners hearing date.",
        issue: "Special commissioners hearing scheduled",
        severity: "high",
        sourceCitation: "Notice at 1",
      },
    ],
    recommendedNextActions: ["Request backup for the traffic-control plan."],
    takingSummary: {
      keyConcerns: ["Driveway access and customer parking may be affected"],
      typeOfTaking: "partial taking",
    },
    timeline: [
      {
        confidence: "high",
        date: "2026-04-08",
        event: "Special commissioners hearing notice was issued",
        sourceCitation: "Notice at 1",
      },
    ],
    valuationSummary: {
      finalOffer: "$125,000",
      initialOffer: "$100,000",
      remainderDamages: "Parking loss may affect remainder value",
      valuationGaps: ["No owner appraisal in selected documents"],
    },
  },
  sourceDocumentId: "doc_notice",
  sourceFileName: "2026-04-08 Special Commissioners Hearing Notice.pdf",
};

describe("Eminent Domain Lawyer Memo composer", () => {
  it("generates the required lawyer memo sections from extraction output", () => {
    const markdown = composeEminentDomainLawyerMemo({
      items: [assessmentItem],
    });

    expect(markdown).toContain("# Lawyer Memo");
    expect(markdown).toContain("## Issue Presented");
    expect(markdown).toContain("## Brief Answer");
    expect(markdown).toContain("## Relevant Facts");
    expect(markdown).toContain("## Procedural Posture");
    expect(markdown).toContain("## Valuation and Damages Issues");
    expect(markdown).toContain("## Access, Parking, and Remainder-Damage Issues");
    expect(markdown).toContain("## Legal and Procedural Flags");
    expect(markdown).toContain("## Missing Information");
    expect(markdown).toContain("## Strategic Considerations");
    expect(markdown).toContain("## Recommended Next Steps");
    expect(markdown).toContain("## Source Notes");
    expect(markdown).toContain("$125,000");
    expect(markdown).toContain(
      "2026-04-08 Special Commissioners Hearing Notice.pdf: Notice at 1",
    );
    expect(markdown).not.toContain('"assessment"');
  });

  it("uses reviewed case assessment content when available", () => {
    const markdown = composeEminentDomainLawyerMemo({
      items: [assessmentItem],
      reviewedCaseAssessmentMarkdown: [
        "# Eminent Domain Case Assessment",
        "",
        "## Case Overview",
        "",
        "- Lawyer edited assessment point about access leverage.",
      ].join("\n"),
    });

    expect(markdown).toContain("lawyer-edited narrative points");
    expect(markdown).toContain("Lawyer edited assessment point about access leverage.");
  });

  it("falls back to extraction output when reviewed assessment content is unavailable", () => {
    const markdown = composeEminentDomainLawyerMemo({
      items: [assessmentItem],
    });

    expect(markdown).toContain("Property owner: Parcel 14 owner");
  });

  it("renders graceful empty notes when extraction produced no facts", () => {
    const markdown = composeEminentDomainLawyerMemo({
      items: [],
    });

    expect(markdown).toContain("# Lawyer Memo");
    expect(markdown.match(new RegExp(LAWYER_MEMO_NO_INFORMATION, "g"))?.length).toBeGreaterThan(5);
  });
});
