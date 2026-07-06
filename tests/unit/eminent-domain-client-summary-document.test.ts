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
  it("generates the required client-facing sections from extraction output", () => {
    const markdown = composeEminentDomainClientSummary({
      items: [assessmentItem],
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
    expect(markdown).toContain(
      "This summary is a draft prepared for attorney review.",
    );
    expect(markdown).not.toContain("doc_notice_internal");
    expect(markdown).not.toContain('"assessment"');
  });

  it("uses reviewed case assessment and lawyer memo content when available", () => {
    const markdown = composeEminentDomainClientSummary({
      items: [assessmentItem],
      reviewedCaseAssessmentMarkdown: [
        "# Eminent Domain Case Assessment",
        "",
        "- Lawyer edited assessment point for client explanation.",
      ].join("\n"),
      reviewedLawyerMemoMarkdown: [
        "# Lawyer Memo",
        "",
        "- Lawyer edited memo point about next steps.",
      ].join("\n"),
    });

    expect(markdown).toContain("Lawyer edited assessment point for client explanation.");
    expect(markdown).toContain("Lawyer edited memo point about next steps.");
  });

  it("falls back to extraction output when prior reviewed work products are unavailable", () => {
    const markdown = composeEminentDomainClientSummary({
      items: [assessmentItem],
    });

    expect(markdown).toContain("Parcel 14 owner");
    expect(markdown).toContain("$125,000");
  });

  it("renders graceful client-facing empty notes when extraction produced no facts", () => {
    const markdown = composeEminentDomainClientSummary({
      items: [],
    });

    expect(markdown).toContain("# Client Summary");
    expect(markdown.match(new RegExp(CLIENT_SUMMARY_NOT_IDENTIFIED, "g"))?.length).toBeGreaterThan(5);
  });
});
