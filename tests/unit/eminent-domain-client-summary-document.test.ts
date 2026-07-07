import { describe, expect, it } from "vitest";

import {
  CLIENT_SUMMARY_NOT_IDENTIFIED,
  composeEminentDomainClientSummary,
} from "../../workflow-steps/extraction/profiles/eminent-domain/client-summary-document";
import type { EminentDomainAssessmentItem } from "../../workflow-steps/extraction/profiles/eminent-domain/schema";

const assessmentItem: EminentDomainAssessmentItem = {
  assessment: {
    matterOverview: {
      condemningAuthority: "Central Texas Mobility Authority",
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
    recommendedNextActions: ["request backup for the traffic-control plan."],
    takingSummary: {
      keyConcerns: ["Driveway access and customer parking may be affected"],
      projectPurpose: "roadway expansion",
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
    },
  },
  sourceDocumentId: "doc_notice_internal",
  sourceFileName: "2026-04-08 Special Commissioners Hearing Notice.pdf",
};

describe("Eminent Domain Client Summary composer", () => {
  const reviewedLawyerMemoMarkdown = [
    "# Lawyer Memo",
    "",
    "## Key Facts",
    "",
    "- Property owner: Parcel 14 owner",
    "",
    "## Property and Taking Summary",
    "",
    "- Type of taking: partial taking",
    "",
    "## Procedural Posture",
    "",
    "- 2026-04-08: Special commissioners hearing notice was issued.",
    "",
    "## Valuation and Damages Issues",
    "",
    "- Final offer: $125,000",
    "",
    "## Missing Documents and Open Questions",
    "",
    "- Owner appraisal has not been provided.",
    "",
    "## Recommended Next Steps",
    "",
    "- Request backup for the traffic-control plan.",
  ].join("\n");

  it("generates the required client-facing sections from the reviewed lawyer memo", () => {
    const markdown = composeEminentDomainClientSummary({
      items: [assessmentItem],
      reviewedLawyerMemoMarkdown,
    });

    expect(markdown).toContain("# Client Summary");
    expect(markdown).toContain("## Overview");
    expect(markdown).toContain("## What We Reviewed");
    expect(markdown).toContain("## What Has Happened So Far");
    expect(markdown).toContain("## Important Issues");
    expect(markdown).toContain("## Questions or Missing Information");
    expect(markdown).toContain("## What We May Need From You");
    expect(markdown).toContain("## Possible Next Steps");
    expect(markdown).toContain("## Important Note");
    expect(markdown).toContain("2026-04-08 Special Commissioners Hearing Notice.pdf");
    expect(markdown).toContain("This summary is based on the reviewed lawyer memo.");
    expect(markdown).not.toContain("doc_notice_internal");
    expect(markdown).not.toContain('"assessment"');
  });

  it("uses reviewed lawyer memo content as the primary source", () => {
    const markdown = composeEminentDomainClientSummary({
      items: [assessmentItem],
      reviewedLawyerMemoMarkdown: [
        "# Lawyer Memo",
        "",
        "## Key Facts",
        "",
        "- Lawyer edited memo point about access impacts.",
        "",
        "## Recommended Next Steps",
        "",
        "- Lawyer edited memo point about next steps.",
      ].join("\n"),
    });

    expect(markdown).toContain("Lawyer edited memo point about access impacts.");
    expect(markdown).toContain("Lawyer edited memo point about next steps.");
  });

  it("fails fast when the reviewed lawyer memo is unavailable", () => {
    expect(() => composeEminentDomainClientSummary({
      items: [assessmentItem],
    })).toThrow("A reviewed lawyer memo is required");
  });

  it("renders graceful client-facing empty notes when extraction produced no facts", () => {
    const markdown = composeEminentDomainClientSummary({
      items: [],
      reviewedLawyerMemoMarkdown: "# Lawyer Memo",
    });

    expect(markdown).toContain("# Client Summary");
    expect(markdown.match(new RegExp(CLIENT_SUMMARY_NOT_IDENTIFIED, "g"))?.length).toBeGreaterThan(5);
  });
});
